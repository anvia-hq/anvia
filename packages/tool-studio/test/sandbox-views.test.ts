import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { serve, type WebSocketServerLike } from "@hono/node-server";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import { registerSandboxViewRoutes } from "../src/runtime/sandbox-views";
import { createStudioSandboxRegistry } from "../src/runtime/sandboxes";
import type {
  StudioSandboxViewControl,
  StudioSandboxViewControlLease,
  StudioSandboxViewControlSnapshot,
} from "../src/types";

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

describe("Studio sandbox views with a connect source", () => {
  it("bridges the viewer to the stream the source opens, without a published port", async () => {
    const stream = createFakeStream();
    const connect = vi.fn(async () => stream);
    const fixture = createConnectApp(connect);
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
      stream.push(Buffer.from("RFB 003.008\n"));
      const [greeting] = await once(viewer, "message");
      expect(Buffer.from(greeting as Buffer).toString("utf8")).toBe("RFB 003.008\n");

      viewer.send(Buffer.from("RFB 003.008\n"));
      await vi.waitFor(() => expect(stream.written).toHaveLength(1));
      expect(Buffer.from(stream.written[0] as Uint8Array).toString("utf8")).toBe("RFB 003.008\n");
      expect(connect).toHaveBeenCalledTimes(1);

      const viewerClosed = once(viewer, "close");
      viewer.close();
      await viewerClosed;
      await vi.waitFor(() => expect(stream.closed).toBe(true));
    } finally {
      fixture.close();
      await Promise.all([
        new Promise<void>((resolve) => websocketServer.close(() => resolve())),
        new Promise<void>((resolve, reject) =>
          server.close((error) => (error === undefined ? resolve() : reject(error))),
        ),
      ]);
    }
  });

  it("closes the viewer when the stream ends", async () => {
    const stream = createFakeStream();
    const fixture = createConnectApp(async () => stream);
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
      const closed = once(viewer, "close");
      stream.end();
      const [code] = await closed;
      expect(code).toBe(1000);
    } finally {
      fixture.close();
      await Promise.all([
        new Promise<void>((resolve) => websocketServer.close(() => resolve())),
        new Promise<void>((resolve, reject) =>
          server.close((error) => (error === undefined ? resolve() : reject(error))),
        ),
      ]);
    }
  });

  it("awaits a control whose operations are asynchronous", async () => {
    const calls: string[] = [];
    let expiresAt = "";
    const lease = {
      id: "lease-1",
      ownerId: "viewer",
      get expiresAt() {
        return expiresAt;
      },
      async renew(options: { leaseTimeoutMs: number }) {
        await Promise.resolve();
        expiresAt = new Date(Date.now() + options.leaseTimeoutMs).toISOString();
        calls.push("renew");
        return { mode: "human" as const, ownerId: "viewer", expiresAt };
      },
      async release() {
        await Promise.resolve();
        calls.push("release");
      },
    };
    const fixture = createConnectApp(async () => createFakeStream(), {
      async snapshot() {
        await Promise.resolve();
        return { mode: "agent" as const };
      },
      async acquireHumanControl(options: { ownerId: string; leaseTimeoutMs: number }) {
        expiresAt = new Date(Date.now() + options.leaseTimeoutMs).toISOString();
        calls.push("acquire");
        return lease;
      },
    });
    const base = `http://studio.test/sandboxes/${fixture.ref}/views/desktop/control`;
    const post = (path: string, body: unknown) =>
      fixture.app.request(`${base}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

    expect(await (await fixture.app.request(base)).json()).toEqual({ mode: "agent" });
    const acquired = await post("/acquire", { ownerId: "viewer", leaseTimeoutMs: 30_000 });
    expect(acquired.status).toBe(201);
    const renewed = await post("/renew", { leaseId: "lease-1", leaseTimeoutMs: 40_000 });
    expect(renewed.status).toBe(200);
    expect(((await renewed.json()) as { expiresAt: string }).expiresAt).toBe(expiresAt);
    expect((await post("/release", { leaseId: "lease-1" })).status).toBe(200);
    expect(calls).toEqual(["acquire", "renew", "release"]);
    fixture.close();
  });

  it("registers a connect source without published ports, and refuses an ambiguous one", () => {
    const registry = createStudioSandboxRegistry(
      [],
      [
        {
          inspector: remoteInspector,
          views: [connectRegistration(async () => createFakeStream())],
        },
      ],
    );
    expect(registry.list()[0]?.views).toEqual([
      { id: "desktop", label: "Desktop", protocol: "novnc" },
    ]);

    const both = {
      ...connectRegistration(async () => createFakeStream()),
      source: {
        protocol: "novnc" as const,
        containerPort: 6080,
        connect: async () => createFakeStream(),
        control: createControl(),
      },
    };
    expect(() =>
      createStudioSandboxRegistry([], [{ inspector: remoteInspector, views: [both] }]),
    ).toThrow("either connect or containerPort");
  });

  it("still needs published ports for a containerPort source", () => {
    expect(() =>
      createStudioSandboxRegistry(
        [],
        [
          {
            inspector: remoteInspector,
            views: [viewRegistration(createControl(), async () => true)],
          },
        ],
      ),
    ).toThrow("published port inspection");
  });
});

const remoteInspector = {
  id: "remote",
  provider: "remote",
  workdir: "/workspace",
  listProcesses: async () => [],
  readProcessLogs: async () => ({
    stdout: new Uint8Array(),
    stderr: new Uint8Array(),
    stdoutTruncated: false,
    stderrTruncated: false,
  }),
};

function createFakeStream() {
  const queue: Uint8Array[] = [];
  let wake: (() => void) | undefined;
  let ended = false;
  let resolveExit: () => void = () => undefined;
  const exit = new Promise<void>((resolve) => {
    resolveExit = resolve;
  });
  const stream = {
    written: [] as Uint8Array[],
    closed: false,
    async write(data: Uint8Array) {
      stream.written.push(data);
    },
    output: {
      async *[Symbol.asyncIterator]() {
        while (!ended || queue.length > 0) {
          const next = queue.shift();
          if (next !== undefined) yield next;
          else await new Promise<void>((resolve) => (wake = resolve));
        }
      },
    },
    close() {
      stream.closed = true;
      stream.end();
    },
    exit,
    push(bytes: Uint8Array) {
      queue.push(bytes);
      wake?.();
    },
    end() {
      ended = true;
      wake?.();
      resolveExit();
    },
  };
  return stream;
}

function connectRegistration(
  connect: () => Promise<ReturnType<typeof createFakeStream>>,
  control: StudioSandboxViewControl = createControl(),
) {
  return {
    id: "desktop",
    label: "Desktop",
    source: { protocol: "novnc" as const, connect, control },
    access: { mode: "authorize" as const, authorize: async () => true },
    authentication: { type: "none" as const },
  };
}

function createConnectApp(
  connect: () => Promise<ReturnType<typeof createFakeStream>>,
  control?: StudioSandboxViewControl,
) {
  const registry = createStudioSandboxRegistry(
    [],
    [{ inspector: remoteInspector, views: [connectRegistration(connect, control)] }],
  );
  const app = new Hono();
  const close = registerSandboxViewRoutes(app, registry);
  const ref = registry.list()[0]?.ref;
  if (ref === undefined) throw new Error("Expected sandbox ref");
  return { app, close, ref };
}

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
