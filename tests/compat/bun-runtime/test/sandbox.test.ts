import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SandboxDaemon } from "@anvia/sandbox/daemon";
import { RemoteSandboxHub, relayTicket } from "@anvia/sandbox/remote";

// Bun replaces the `ws` package with its own WebSocket, which has no pause() or resume(). The hub's
// browser relays used both, so the first message from a browser threw inside a promise callback
// and took the process down. This runs the real relay on Bun: a hub, a daemon and a service on its
// loopback, and a browser-style client.

const sandboxId = "bun-sandbox";
const uncaught: unknown[] = [];
const onUncaught = (error: unknown) => uncaught.push(error);
process.on("uncaughtException", onUncaught);
process.on("unhandledRejection", onUncaught);

let hub: RemoteSandboxHub;
let daemon: SandboxDaemon;
let service: net.Server;
let hubPort = 0;
const sockets: net.Socket[] = [];

beforeAll(async () => {
  const root = await mkdtemp(join(tmpdir(), "anvia-bun-sandbox-"));
  await mkdir(join(root, "workspace"));
  service = net.createServer((socket) => {
    sockets.push(socket);
    socket.on("error", () => undefined);
    socket.pipe(socket);
  });
  await new Promise<void>((resolve) => service.listen(0, "127.0.0.1", resolve));
  const servicePort = (service.address() as net.AddressInfo).port;

  hub = new RemoteSandboxHub({
    authorize: (token) => (token === "daemon-token" ? { sandboxId } : null),
    authorizeTunnel: (request) =>
      relayTicket(request) === "browser-ticket" ? { sandboxId, port: servicePort } : null,
    allowedOrigins: [],
    connectTimeoutMs: 10_000,
  });
  hubPort = (await hub.listen({ host: "127.0.0.1", path: "/daemon", tunnelPath: "/tunnel" })).port;
  daemon = new SandboxDaemon({
    controlUrl: `ws://127.0.0.1:${hubPort}/daemon`,
    token: "daemon-token",
    workdir: join(root, "workspace"),
    stateDir: join(root, "state"),
    terminal: false,
    desktop: false,
  });
  daemon.start();
  await daemon.ready();
});

afterAll(async () => {
  process.off("uncaughtException", onUncaught);
  process.off("unhandledRejection", onUncaught);
  for (const socket of sockets) socket.destroy();
  await daemon.stop();
  await hub.close();
  await new Promise<void>((resolve) => service.close(() => resolve()));
});

/** A browser's view of a tunnel: every byte it gets back, and why it was closed. */
async function browser(port = hubPort) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/tunnel`, [
    "anvia.ticket.browser-ticket",
    "anvia.tunnel.v1",
  ]);
  socket.binaryType = "arraybuffer";
  const state = { received: 0, closed: undefined as { code: number; reason: string } | undefined };
  socket.onmessage = (event) => {
    state.received += (event.data as ArrayBuffer).byteLength;
  };
  socket.onclose = (event) => {
    state.closed = { code: event.code, reason: event.reason };
  };
  await new Promise<void>((resolve, reject) => {
    socket.onopen = () => resolve();
    socket.onerror = () => reject(new Error("The browser socket could not connect."));
  });
  return { socket, state };
}

async function until(condition: () => boolean, ms = 10_000) {
  const deadline = Date.now() + ms;
  while (!condition() && Date.now() < deadline) await Bun.sleep(10);
  expect(condition()).toBe(true);
}

describe("sandbox browser relay on Bun", () => {
  it("relays a browser's frames to the service and back without throwing", async () => {
    const { socket, state } = await browser();
    const frame = new Uint8Array(16 * 1024).fill(7);
    const frames = 64; // 1 MiB.
    for (let index = 0; index < frames; index += 1) {
      socket.send(frame);
      if (index % 8 === 7) await Bun.sleep(5);
    }
    await until(() => state.received >= frame.byteLength * frames);
    expect(state.closed).toBeUndefined();
    socket.close();
    await Bun.sleep(100);
    expect(uncaught).toEqual([]);
  });

  it("survives a browser that outruns the service, and ends it with a reason if it queues too much", async () => {
    // A daemon that opens tunnels and never acknowledges a byte, so the hub's writes back up at its
    // window on any machine, whatever the kernel's buffers or the runtime's sockets do.
    const stalled = new RemoteSandboxHub({
      authorize: (token) => (token === "daemon-token" ? { sandboxId } : null),
      authorizeTunnel: (request) =>
        relayTicket(request) === "browser-ticket" ? { sandboxId, port: 1 } : null,
      allowedOrigins: [],
      connectTimeoutMs: 10_000,
    });
    const { port } = await stalled.listen({
      host: "127.0.0.1",
      path: "/daemon",
      tunnelPath: "/tunnel",
    });
    const fakeDaemon = new WebSocket(`ws://127.0.0.1:${port}/daemon`, {
      headers: { authorization: "Bearer daemon-token" },
    } as unknown as string[]);
    fakeDaemon.onmessage = (event) => {
      const frame = JSON.parse(String(event.data)) as { type: string; tunnelId?: string };
      if (frame.type === "tunnel.open") {
        fakeDaemon.send(JSON.stringify({ type: "tunnel.opened", tunnelId: frame.tunnelId }));
      }
    };
    await new Promise<void>((resolve) => (fakeDaemon.onopen = () => resolve()));
    fakeDaemon.send(
      JSON.stringify({
        type: "hello",
        protocolVersion: 1,
        daemonVersion: "stalled",
        workdir: "/w",
        capabilities: ["tunnel"],
      }),
    );
    try {
      await until(() => stalled.isConnected(sandboxId));
      const { socket, state } = await browser(port);
      // 50 MiB in one go. The relay cannot pause the browser's socket (nothing to pause with), so
      // it must not crash and must not hold all of it. Where Bun's own sockets keep delivering, the
      // relay passes its 4 MiB limit and closes the browser with a reason. Where they stop reading
      // first (Bun on Linux does, after a few MB), the runtime's backpressure is the bound and the
      // browser stays open. The relay's own limit is pinned in the hub's unit tests either way.
      const frame = new Uint8Array(128 * 1024).fill(1);
      for (let index = 0; index < 400; index += 1) socket.send(frame);
      await Bun.sleep(2_000);
      expect(uncaught).toEqual([]);
      if (state.closed !== undefined) {
        expect(state.closed).toEqual({
          code: 1008,
          reason: "sending faster than the service reads",
        });
      }
      expect(stalled.isConnected(sandboxId)).toBe(true); // The hub itself is fine.
    } finally {
      fakeDaemon.close();
      await stalled.close();
    }
  }, 20_000);
});
