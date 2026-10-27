import { afterEach, describe, expect, it, vi } from "vitest";
import { DockerSandboxError } from "../src/errors";
import type { SandboxDesktop } from "../src/remote/desktop";
import type { RemoteSandboxHub } from "../src/remote/hub";
import type { DesktopControl } from "../src/remote/protocol";
import { studioDesktopView, studioSandbox } from "../src/remote/studio";
import type { TunnelHandle } from "../src/remote/tunnel";
import type { SandboxRuntime } from "../src/types";

const bytes = (...values: number[]) => Uint8Array.from(values);
const join = (...parts: Uint8Array[]) => Uint8Array.from(parts.flatMap((part) => [...part]));
const ascii = (text: string) => new TextEncoder().encode(text);
const handshake = join(ascii("RFB 003.008\n"), bytes(1), bytes(1));
const keyEvent = bytes(4, 1, 0, 0, 0, 0, 0, 0x61);
const updateRequest = bytes(3, 1, 0, 0, 0, 0, 3, 0, 2, 0);

afterEach(() => {
  vi.useRealTimers();
});

describe("studioSandbox", () => {
  it("registers the runtime's inspector and a desktop view", () => {
    const runtime = fakeRuntime();
    const hub = fakeHub(runtime, fakeDesktop());
    const registration = studioSandbox(hub, "sandbox-1", {
      agentIds: ["agent"],
      toolNames: ["desktop_click"],
      workdir: "/work",
    });

    expect(hub.runtime).toHaveBeenCalledWith("sandbox-1", { workdir: "/work" });
    expect(registration.inspector).toMatchObject({
      id: "sandbox-1",
      provider: "remote",
      workdir: "/workspace",
    });
    expect(registration.agentIds).toEqual(["agent"]);
    expect(registration.toolNames).toEqual(["desktop_click"]);
    expect(registration.views?.map((view) => [view.id, view.label])).toEqual([
      ["desktop", "Desktop"],
    ]);
    expect(registration.views?.[0]).toMatchObject({
      access: { mode: "local" },
      authentication: { type: "none" },
    });
  });

  it("leaves the desktop out, or names it, when asked", () => {
    const hub = fakeHub(fakeRuntime(), fakeDesktop());

    expect(studioSandbox(hub, "s", { desktop: false }).views).toBeUndefined();
    expect(
      studioSandbox(hub, "s", { desktop: { id: "screen", label: "Screen" } }).views?.[0],
    ).toMatchObject({ id: "screen", label: "Screen" });
  });
});

describe("studioDesktopView control", () => {
  it("reports who holds the desktop", async () => {
    const desktop = fakeDesktop();
    const { source } = studioDesktopView(desktop);

    expect(await source.control.snapshot()).toEqual({ mode: "agent" });
    desktop.state = { held: true, holder: "alice", expiresAt: "2026-01-01T00:00:30.000Z" };
    expect(await source.control.snapshot()).toEqual({
      mode: "human",
      ownerId: "alice",
      expiresAt: "2026-01-01T00:00:30.000Z",
    });
  });

  it("takes, renews and releases the hold for the owner Studio names", async () => {
    const desktop = fakeDesktop();
    const { source } = studioDesktopView(desktop);

    const lease = await source.control.acquireHumanControl({
      ownerId: "alice",
      leaseTimeoutMs: 30_000,
    });
    expect(desktop.calls).toEqual([["takeover", { holder: "alice", leaseMs: 30_000 }]]);
    expect(lease.ownerId).toBe("alice");

    const renewed = await lease.renew({ leaseTimeoutMs: 40_000 });
    expect(renewed).toMatchObject({ mode: "human", ownerId: "alice" });
    expect(lease.expiresAt).toBe(desktop.state.expiresAt);

    await lease.release();
    expect(desktop.calls.at(-1)).toEqual(["release", { holder: "alice" }]);
  });

  it("turns a lock held by someone else into the codes Studio reads", async () => {
    const desktop = fakeDesktop();
    const { source } = studioDesktopView(desktop);
    desktop.lockedBy = "bob";

    await expect(
      source.control.acquireHumanControl({ ownerId: "alice", leaseTimeoutMs: 30_000 }),
    ).rejects.toMatchObject({ code: "human_controlled" });

    desktop.lockedBy = undefined;
    const lease = await source.control.acquireHumanControl({
      ownerId: "alice",
      leaseTimeoutMs: 30_000,
    });
    desktop.lockedBy = "bob";
    await expect(lease.renew({ leaseTimeoutMs: 30_000 })).rejects.toMatchObject({
      code: "invalid_state",
    });
  });
});

describe("studioDesktopView stream", () => {
  it("passes the VNC stream through, and drops the viewer's input unless it holds control", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const desktop = fakeDesktop();
    const { source } = studioDesktopView(desktop);
    const stream = await source.connect({});

    await stream.write(handshake);
    await stream.write(keyEvent);
    await stream.write(updateRequest);
    expect(desktop.tunnel.written).toEqual([join(handshake), join(updateRequest)]);

    const lease = await source.control.acquireHumanControl({
      ownerId: "alice",
      leaseTimeoutMs: 30_000,
    });
    await stream.write(keyEvent);
    expect(desktop.tunnel.written.at(-1)).toEqual(keyEvent);

    await lease.release();
    const writes = desktop.tunnel.written.length;
    await stream.write(keyEvent);
    expect(desktop.tunnel.written).toHaveLength(writes);
  });

  it("stops passing input once the lease has run out", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const desktop = fakeDesktop();
    const { source } = studioDesktopView(desktop);
    const stream = await source.connect({});
    await stream.write(handshake);
    await source.control.acquireHumanControl({ ownerId: "alice", leaseTimeoutMs: 30_000 });

    await stream.write(keyEvent);
    expect(desktop.tunnel.written.at(-1)).toEqual(keyEvent);

    vi.setSystemTime(new Date("2026-01-01T00:00:31.000Z"));
    desktop.tunnel.written.length = 0;
    await stream.write(keyEvent);
    expect(desktop.tunnel.written).toEqual([]);
  });

  it("ends the connection when the viewer sends something the filter cannot follow", async () => {
    const desktop = fakeDesktop();
    const stream = await studioDesktopView(desktop).source.connect({});

    await expect(stream.write(ascii("not a vnc client"))).rejects.toThrow();
    expect(desktop.tunnel.closed).toBe(true);
  });

  it("hands output and exit straight through", async () => {
    const desktop = fakeDesktop();
    const stream = await studioDesktopView(desktop).source.connect({});
    const chunks: Uint8Array[] = [];
    desktop.tunnel.push(ascii("RFB 003.008\n"));
    desktop.tunnel.end();
    for await (const chunk of stream.output) chunks.push(chunk);

    expect(new TextDecoder().decode(chunks[0])).toBe("RFB 003.008\n");
    await expect(stream.exit).resolves.toBe("remote");
  });
});

function fakeRuntime() {
  return {
    id: "sandbox-1",
    provider: "remote",
    workdir: "/workspace",
    listFiles: vi.fn(),
    readFile: vi.fn(),
    listProcesses: vi.fn(),
    readProcessLogs: vi.fn(),
  } as unknown as SandboxRuntime;
}

function fakeHub(runtime: SandboxRuntime, desktop: SandboxDesktop) {
  return {
    runtime: vi.fn(() => runtime),
    desktop: vi.fn(() => desktop),
  } as unknown as RemoteSandboxHub;
}

function fakeDesktop() {
  const tunnel = fakeTunnel();
  const desktop = {
    calls: [] as Array<[string, unknown]>,
    state: { held: false } as DesktopControl,
    lockedBy: undefined as string | undefined,
    tunnel,
    async control() {
      return desktop.state;
    },
    async takeover(options: { holder: string; leaseMs?: number }) {
      desktop.calls.push(["takeover", { holder: options.holder, leaseMs: options.leaseMs }]);
      if (desktop.lockedBy !== undefined && desktop.lockedBy !== options.holder) {
        throw new DockerSandboxError(`Held by ${desktop.lockedBy}.`, "desktop_locked");
      }
      desktop.state = {
        held: true,
        holder: options.holder,
        expiresAt: new Date(Date.now() + (options.leaseMs ?? 60_000)).toISOString(),
      };
      return desktop.state;
    },
    async release(options: { holder?: string }) {
      desktop.calls.push(["release", { holder: options.holder }]);
      desktop.state = { held: false };
      return desktop.state;
    },
    async openViewer() {
      return tunnel as unknown as TunnelHandle;
    },
  };
  return desktop as typeof desktop & SandboxDesktop;
}

function fakeTunnel() {
  const queue: Uint8Array[] = [];
  let wake: (() => void) | undefined;
  let ended = false;
  let resolveExit: (reason: string) => void = () => undefined;
  const tunnel = {
    port: 5900,
    written: [] as Uint8Array[],
    closed: false,
    async write(data: Uint8Array) {
      tunnel.written.push(data);
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
      tunnel.closed = true;
      tunnel.end();
    },
    exit: new Promise<string>((resolve) => {
      resolveExit = resolve;
    }),
    push(chunk: Uint8Array) {
      queue.push(chunk);
      wake?.();
    },
    end() {
      ended = true;
      wake?.();
      resolveExit("remote");
    },
  };
  return tunnel;
}
