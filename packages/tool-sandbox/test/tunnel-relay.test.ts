import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket, { WebSocketServer } from "ws";
import type { TunnelHandle } from "../src/remote/index";
import { bridgeTunnel } from "../src/remote/tunnel-relay";
import { eventually } from "./support/remote-harness";

const servers: WebSocketServer[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

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

async function connect(opening: Promise<TunnelHandle>) {
  const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  servers.push(server);
  const sockets: WebSocket[] = [];
  server.on("connection", (ws) => {
    sockets.push(ws);
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
});
