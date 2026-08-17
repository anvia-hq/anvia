import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { serve, type WebSocketServerLike } from "@hono/node-server";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import { registerSandboxViewRoutes } from "../src/runtime/sandbox-views";
import { createStudioSandboxRegistry } from "../src/runtime/sandboxes";
import type { StudioSandboxViewControlLease, StudioSandboxViewControlSnapshot } from "../src/types";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Studio sandbox views", () => {
  it("authorizes every control operation and manages an explicit lease", async () => {
    const authorize = vi.fn(async () => true);
    const fixture = createViewApp(authorize);
    const base = `/sandboxes/${fixture.ref}/views/desktop/control`;

    const acquire = await fixture.app.request(`http://studio.test${base}/acquire`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ownerId: "viewer", leaseTimeoutMs: 30_000 }),
    });
    expect(acquire.status).toBe(201);
    const lease = (await acquire.json()) as { id: string };
    expect(fixture.control.snapshot()).toMatchObject({ mode: "human", ownerId: "viewer" });

    const renew = await fixture.app.request(`http://studio.test${base}/renew`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ leaseId: lease.id, leaseTimeoutMs: 40_000 }),
    });
    expect(renew.status).toBe(200);

    const release = await fixture.app.request(`http://studio.test${base}/release`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ leaseId: lease.id }),
    });
    expect(release.status).toBe(200);
    expect(fixture.control.snapshot()).toEqual({ mode: "agent" });
    expect(authorize).toHaveBeenCalledTimes(3);
    fixture.close();
  });

  it("denies access when the application authorizer rejects it", async () => {
    const fixture = createViewApp(async () => false);
    const response = await fixture.app.request(
      `http://studio.test/sandboxes/${fixture.ref}/views/desktop/control`,
    );
    expect(response.status).toBe(403);
    fixture.close();
  });

  it("releases an expired takeover lease when pruning Studio state", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T00:00:00.000Z"));
    const fixture = createViewApp(async () => true);
    const base = `/sandboxes/${fixture.ref}/views/desktop/control`;
    await fixture.app.request(`http://studio.test${base}/acquire`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ownerId: "viewer", leaseTimeoutMs: 5_000 }),
    });
    vi.setSystemTime(new Date("2026-08-17T00:00:06.000Z"));

    const response = await fixture.app.request(`http://studio.test${base}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ mode: "agent" });
    fixture.close();
  });

  it("returns an authorized no-store viewer connection without putting credentials in the URL", async () => {
    const fixture = createViewApp(async () => true);
    const response = await fixture.app.request(
      `http://studio.test/sandboxes/${fixture.ref}/views/desktop/connection`,
      { headers: { authorization: "Bearer secret", cookie: "session=secret" } },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      sandboxRef: fixture.ref,
      viewId: "desktop",
      protocol: "novnc",
      websocketPath: `/sandboxes/${fixture.ref}/views/desktop/ws`,
      authentication: { type: "password", password: "password" },
    });
    expect(response.url).not.toContain("password");
    fixture.close();
  });

  it("keeps view authentication out of sandbox discovery metadata", () => {
    const fixture = createViewApp(async () => true);
    const serialized = JSON.stringify(fixture.registry.list());
    expect(serialized).not.toContain("authentication");
    expect(serialized).not.toContain("password");
    fixture.close();
  });

  it("bridges noVNC WebSocket messages through the embedded Studio upgrade path", async () => {
    const upstream = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await once(upstream, "listening");
    const upstreamAddress = upstream.address() as AddressInfo;
    upstream.on("connection", (socket) => {
      socket.on("message", (data, isBinary) => socket.send(data, { binary: isBinary }));
    });

    const fixture = createViewApp(async () => true, upstreamAddress.port);
    const websocketServer = new WebSocketServer({ noServer: true });
    const server = serve({
      fetch: fixture.app.fetch,
      hostname: "127.0.0.1",
      port: 0,
      websocket: { server: websocketServer as unknown as WebSocketServerLike },
    });
    await once(server, "listening");
    const address = server.address() as AddressInfo;
    const viewer = new WebSocket(
      `ws://127.0.0.1:${address.port}/sandboxes/${fixture.ref}/views/desktop/ws`,
    );

    try {
      await once(viewer, "open");
      viewer.send(Buffer.from("hello"));
      const [data] = await once(viewer, "message");
      expect(Buffer.from(data as Buffer).toString("utf8")).toBe("hello");
    } finally {
      const viewerClosed = once(viewer, "close");
      viewer.close();
      await viewerClosed;
      fixture.close();
      await Promise.all([
        new Promise<void>((resolve) => websocketServer.close(() => resolve())),
        new Promise<void>((resolve, reject) =>
          server.close((error) => (error === undefined ? resolve() : reject(error))),
        ),
        new Promise<void>((resolve) => upstream.close(() => resolve())),
      ]);
    }
  });

  it("rejects non-loopback view registrations", () => {
    expect(() =>
      createStudioSandboxRegistry(
        [],
        [
          {
            inspector: {
              id: "browser",
              provider: "docker",
              workdir: "/workspace",
              publishedPorts: [
                { containerPort: 6080, host: "0.0.0.0", hostPort: 49152, protocol: "tcp" },
              ],
            },
            views: [viewRegistration(createControl(), async () => true)],
          },
        ],
      ),
    ).toThrow("loopback-published");
  });
});

function createViewApp(authorize: () => boolean | Promise<boolean>, hostPort = 49152) {
  const control = createControl();
  const registry = createStudioSandboxRegistry(
    [],
    [
      {
        inspector: {
          id: "browser",
          provider: "docker",
          workdir: "/workspace",
          publishedPorts: [{ containerPort: 6080, host: "127.0.0.1", hostPort, protocol: "tcp" }],
        },
        views: [viewRegistration(control, authorize)],
      },
    ],
  );
  const app = new Hono();
  const close = registerSandboxViewRoutes(app, registry);
  const ref = registry.list()[0]?.ref;
  if (ref === undefined) throw new Error("Expected sandbox ref");
  return { app, close, control, ref, registry };
}

function viewRegistration(
  control: ReturnType<typeof createControl>,
  authorize: () => boolean | Promise<boolean>,
) {
  return {
    id: "desktop",
    label: "Browser",
    source: { protocol: "novnc" as const, containerPort: 6080, control },
    access: {
      mode: "authorize" as const,
      authorize,
    },
    authentication: { type: "password" as const, password: "password" },
  };
}

function createControl() {
  let lease: StudioSandboxViewControlLease | undefined;
  return {
    snapshot(): StudioSandboxViewControlSnapshot {
      return lease === undefined
        ? { mode: "agent" }
        : { mode: "human", ownerId: lease.ownerId, expiresAt: lease.expiresAt };
    },
    async acquireHumanControl(options: { ownerId: string; leaseTimeoutMs: number }) {
      let expiresAt = new Date(Date.now() + options.leaseTimeoutMs).toISOString();
      const next = {
        id: "lease-1",
        ownerId: options.ownerId,
        get expiresAt() {
          return expiresAt;
        },
        renew(renewOptions: { leaseTimeoutMs: number }) {
          expiresAt = new Date(Date.now() + renewOptions.leaseTimeoutMs).toISOString();
          return { mode: "human" as const, ownerId: options.ownerId, expiresAt };
        },
        release() {
          lease = undefined;
        },
      };
      lease = next;
      return next;
    },
  };
}
