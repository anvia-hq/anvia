import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket, { WebSocketServer } from "ws";
import type { TunnelHandle } from "../src/remote/index";
import { bridgeTunnel } from "../src/remote/tunnel-relay";
import { eventually } from "./support/remote-harness";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const servers: WebSocketServer[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

/** A tunnel that takes whatever it is given at once and remembers it. */
function recordingTunnel() {
  const written: Uint8Array[] = [];
  const handle: TunnelHandle = {
    port: 1,
    write: (data) => {
      written.push(typeof data === "string" ? new TextEncoder().encode(data) : data);
      return Promise.resolve();
    },
    output: { [Symbol.asyncIterator]: () => ({ next: () => new Promise<never>(() => undefined) }) },
    close: () => undefined,
    exit: new Promise(() => undefined),
  };
  return { handle, written };
}

/** A tunnel whose writes finish only when the test says so, standing in for a slow service. */
function slowTunnel() {
  const releases: Array<() => void> = [];
  const write = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        releases.push(resolve);
      }),
  );
  const handle: TunnelHandle = {
    port: 1,
    write,
    // Output that never arrives.
    output: { [Symbol.asyncIterator]: () => ({ next: () => new Promise<never>(() => undefined) }) },
    close: () => undefined,
    exit: new Promise(() => undefined),
  };
  return {
    handle,
    write,
    /** Let the write in flight finish. */
    release: () => releases.shift()?.(),
  };
}

/**
 * `withoutPause` strips pause and resume from the relay's socket, as on a runtime that replaces the
 * `ws` package with its own WebSocket (Bun does, and its sockets cannot be paused).
 */
async function connect(opening: Promise<TunnelHandle>, options: { withoutPause?: boolean } = {}) {
  const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  servers.push(server);
  const sockets: WebSocket[] = [];
  server.on("connection", (ws) => {
    sockets.push(ws);
    if (options.withoutPause === true) {
      Object.assign(ws, { pause: undefined, resume: undefined });
    }
    bridgeTunnel(ws, opening);
  });
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address() as { port: number };
  const client = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise((resolve) => client.once("open", resolve));
  await eventually(() => sockets.length === 1);
  return { client, server: sockets[0] as WebSocket };
}

describe("bridgeTunnel", () => {
  it("stops reading from a browser that sends faster than the service takes data, and resumes after", async () => {
    const tunnel = slowTunnel();
    const { client, server } = await connect(Promise.resolve(tunnel.handle));

    const frame = Buffer.alloc(128 * 1024, 5);
    const frames = 40; // 5 MiB, well past the 1 MiB the relay will queue.
    for (let index = 0; index < frames; index += 1) client.send(frame);

    // Whatever the kernel buffers absorb, the relay's own queue passed its limit, so it paused the
    // socket instead of reading everything into memory. Writes are one at a time, in order.
    await eventually(() => server.isPaused);
    expect(tunnel.write).toHaveBeenCalledTimes(1);

    // As the service takes data the queue drains and reading resumes, until everything is through.
    await eventually(() => {
      tunnel.release();
      return tunnel.write.mock.calls.length === frames && !server.isPaused;
    }, 15_000);
    client.close();
  }, 30_000);

  it("never pauses a browser that stays within the limit", async () => {
    const tunnel = slowTunnel();
    const { client, server } = await connect(Promise.resolve(tunnel.handle));
    for (let index = 0; index < 4; index += 1) client.send(Buffer.alloc(64 * 1024, 1));
    await eventually(() => tunnel.write.mock.calls.length === 1);
    expect(server.isPaused).toBe(false);
    client.close();
  });

  describe("on a socket that cannot pause", () => {
    it("still relays every frame, in order, without throwing", async () => {
      // Throwing from the write chain (ws.resume is not a function) is an unhandled rejection,
      // which fails this run.
      const tunnel = recordingTunnel();
      const { client, server } = await connect(Promise.resolve(tunnel.handle), {
        withoutPause: true,
      });
      expect(server.pause).toBeUndefined();

      const frames = 96; // 6 MiB in all, over the limit if nothing ever left the queue.
      for (let index = 0; index < frames; index += 1) client.send(Buffer.alloc(64 * 1024, index));
      await eventually(() => tunnel.written.length === frames, 15_000);
      expect(tunnel.written.map((frame) => frame[0])).toEqual(
        Array.from({ length: frames }, (_, index) => index),
      );
      expect(client.readyState).toBe(WebSocket.OPEN);
      client.close();
    }, 30_000);

    it("takes the largest clipboard message a viewer may send, which is not a disconnect", async () => {
      const tunnel = recordingTunnel();
      const { client } = await connect(Promise.resolve(tunnel.handle), { withoutPause: true });
      client.send(Buffer.alloc(1024 * 1024 + 8, 3)); // The desktop filter's cap, plus its header.
      await eventually(() => tunnel.written.length === 1);
      expect(tunnel.written[0]?.byteLength).toBe(1024 * 1024 + 8);
      expect(client.readyState).toBe(WebSocket.OPEN);
      client.close();
    });

    it("lets the queue drain, so frames sent after a slow write are not counted twice", async () => {
      const tunnel = slowTunnel();
      const { client } = await connect(Promise.resolve(tunnel.handle), { withoutPause: true });
      const closed = vi.fn();
      client.on("close", closed);

      client.send(Buffer.alloc(3 * 1024 * 1024, 1));
      await eventually(() => tunnel.write.mock.calls.length === 1);
      tunnel.release();
      await sleep(100);
      // Had the first frame stayed counted, this one would pass the 4 MiB limit and end the socket.
      client.send(Buffer.alloc(3 * 1024 * 1024, 2));
      await eventually(() => tunnel.write.mock.calls.length === 2);
      tunnel.release();
      await sleep(100);
      expect(closed).not.toHaveBeenCalled();
      client.close();
    }, 30_000);

    it("closes a browser that outruns the service, with a reason, instead of buffering without end", async () => {
      const tunnel = slowTunnel();
      const { client } = await connect(Promise.resolve(tunnel.handle), { withoutPause: true });
      const closing = new Promise<{ code: number; reason: string }>((resolve) =>
        client.once("close", (code, reason) => resolve({ code, reason: reason.toString() })),
      );

      // 8 MiB at a service that never finishes its first write.
      for (let index = 0; index < 64; index += 1) client.send(Buffer.alloc(128 * 1024, 5));

      const { code, reason } = await closing;
      expect(code).toBe(1008);
      expect(reason).toBe("sending faster than the service reads");
      // One write was in flight, and nothing behind it kept going.
      expect(tunnel.write.mock.calls.length).toBeLessThanOrEqual(1);
    }, 30_000);
  });
});
