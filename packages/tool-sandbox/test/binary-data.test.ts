import { createHash, randomBytes } from "node:crypto";
import http from "node:http";
import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket, { WebSocketServer } from "ws";
import { SandboxDaemon } from "../src/daemon/index";
import { RemoteSandboxHub, type TunnelHandle } from "../src/remote/index";
import { RfbClientFilter } from "../src/remote/rfb-filter";
import { bridgeTunnel } from "../src/remote/tunnel-relay";
import {
  type RemoteHarness,
  type RemoteHarnessOptions,
  createRemoteHarness,
  eventually,
  sandboxId,
  token,
} from "./support/remote-harness";
import { WsRecorder } from "./support/ws-recorder";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function freePort(): Promise<number> {
  const probe = net.createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", () => resolve()));
  const { port } = probe.address() as net.AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

/** A harness whose daemon reaches the hub through a recorder that notes every message. */
async function recorded(options: RemoteHarnessOptions = {}) {
  const hubPort = await freePort();
  const recorder = new WsRecorder(hubPort);
  cleanups.push(() => recorder.close());
  const recorderPort = await recorder.listen();
  const h: RemoteHarness = await createRemoteHarness({
    ...options,
    listen: { port: hubPort },
    daemon: { ...options.daemon, controlUrl: `ws://127.0.0.1:${recorderPort}` },
  });
  cleanups.push(() => h.cleanup());
  return { h, recorder };
}

/** A service on this machine's loopback, which is "the sandbox" to the daemon. */
async function listen(onConnection: (socket: net.Socket) => void) {
  const sockets: net.Socket[] = [];
  const server = net.createServer((socket) => {
    sockets.push(socket);
    socket.on("error", () => undefined);
    onConnection(socket);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  cleanups.push(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  return (server.address() as net.AddressInfo).port;
}

const echo = (socket: net.Socket) => socket.pipe(socket);
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Write `data` to a tunnel in pieces, and read back as many bytes as were written. */
async function roundTrip(handle: TunnelHandle, data: Uint8Array): Promise<Uint8Array> {
  const received = new Uint8Array(data.byteLength);
  let got = 0;
  const reading = (async () => {
    for await (const chunk of handle.output) {
      received.set(chunk.subarray(0, received.byteLength - got), got);
      got += chunk.byteLength;
      if (got >= received.byteLength) break;
    }
  })();
  for (let start = 0; start < data.byteLength; start += 40_000) {
    await handle.write(data.subarray(start, start + 40_000));
  }
  await reading;
  return received;
}

describe("binary tunnel data", () => {
  it("carries bytes both ways as binary messages, and only the acks as JSON", async () => {
    const port = await listen(echo);
    const { h, recorder } = await recorded();
    const handle = await h.hub.tunnel(sandboxId).open(port);
    const data = new Uint8Array(randomBytes(1024 * 1024));

    const back = await roundTrip(handle, data);
    handle.close();

    expect(sha(back)).toBe(sha(data));
    expect(recorder.binary("hub").bytes).toBeGreaterThanOrEqual(data.byteLength);
    expect(recorder.binary("daemon").bytes).toBeGreaterThanOrEqual(data.byteLength);
    // Not one data byte went through base64 and JSON.
    expect(recorder.text("hub", "tunnel.data")).toBe(0);
    expect(recorder.text("daemon", "tunnel.data")).toBe(0);
    expect(recorder.text("daemon", "tunnel.ack")).toBeGreaterThan(0);
    expect(recorder.text("hub", "tunnel.ack")).toBeGreaterThan(0);
  }, 30_000);

  it("keeps a large transfer whole and in order", async () => {
    const total = 8 * 1024 * 1024;
    const port = await listen((socket) => {
      let sent = 0;
      const pump = () => {
        while (sent < total) {
          const chunk = Buffer.alloc(Math.min(48 * 1024, total - sent));
          for (let index = 0; index < chunk.length; index += 1) chunk[index] = (sent + index) % 251;
          sent += chunk.length;
          if (!socket.write(chunk)) return void socket.once("drain", pump);
        }
        socket.end();
      };
      pump();
    });
    const { h, recorder } = await recorded();
    const handle = await h.hub.tunnel(sandboxId).open(port, { profile: "interactive" });

    let offset = 0;
    let wrong = -1;
    for await (const chunk of handle.output) {
      for (let index = 0; index < chunk.length && wrong === -1; index += 1) {
        if (chunk[index] !== (offset + index) % 251) wrong = offset + index;
      }
      offset += chunk.length;
    }
    expect(wrong).toBe(-1);
    expect(offset).toBe(total);
    expect(recorder.binary("daemon").bytes).toBeGreaterThanOrEqual(total);
  }, 30_000);

  it("stops the service at the window when nobody reads, with the bytes arriving as binary", async () => {
    const port = await listen((socket) => {
      const pump = () => {
        while (socket.write(Buffer.alloc(64 * 1024, 7))) continue;
        socket.once("drain", pump);
      };
      pump();
    });
    const { h, recorder } = await recorded();
    const handle = await h.hub.tunnel(sandboxId).open(port, { profile: "interactive" });
    await sleep(1_000);

    // The window is 2 MiB, and a frame may cross the mark; nothing near an unbounded flood.
    const sent = recorder.binary("daemon").bytes;
    expect(sent).toBeGreaterThan(1024 * 1024);
    expect(sent).toBeLessThan(2.25 * 1024 * 1024);
    // Reading releases more.
    let read = 0;
    for await (const chunk of handle.output) {
      read += chunk.byteLength;
      if (read >= 4 * 1024 * 1024) break;
    }
    expect(read).toBeGreaterThanOrEqual(4 * 1024 * 1024);
    handle.close();
  }, 30_000);

  describe("with a peer that cannot take it", () => {
    const cases: Array<[string, RemoteHarnessOptions]> = [
      ["a hub that has it switched off", { hub: { binaryData: false } }],
      ["a daemon that has it switched off", { daemon: { binaryData: false } }],
      ["neither side", { hub: { binaryData: false }, daemon: { binaryData: false } }],
    ];

    it.each(cases)(
      "falls back to JSON with %s, and still moves data whole",
      async (_name, options) => {
        const port = await listen(echo);
        const { h, recorder } = await recorded(options);
        const handle = await h.hub.tunnel(sandboxId).open(port);
        const data = new Uint8Array(randomBytes(256 * 1024));

        const back = await roundTrip(handle, data);
        handle.close();

        expect(sha(back)).toBe(sha(data));
        expect(recorder.binary("hub").count).toBe(0);
        expect(recorder.binary("daemon").count).toBe(0);
        expect(recorder.text("hub", "tunnel.data")).toBeGreaterThan(0);
        expect(recorder.text("daemon", "tunnel.data")).toBeGreaterThan(0);
      },
      30_000,
    );

    it("lets a daemon that predates binary frames work, as one that never mentions them", async () => {
      // A daemon from before binary frames has tunnels but does not list binary-data, and it would
      // not parse a binary message.
      const hubPort = await freePort();
      const hub = new RemoteSandboxHub({
        authorize: (candidate) => (candidate === token ? { sandboxId } : null),
        connectTimeoutMs: 5_000,
      });
      cleanups.push(() => hub.close());
      await hub.listen({ host: "127.0.0.1", port: hubPort });
      const socket = new WebSocket(`ws://127.0.0.1:${hubPort}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      cleanups.push(() => socket.terminate());
      const received: Array<{ binary: boolean; type?: string }> = [];
      socket.on("message", (data, binary) => {
        const type = binary ? undefined : (JSON.parse(data.toString()) as { type: string }).type;
        received.push(type === undefined ? { binary } : { binary, type });
        const frame = binary ? undefined : (JSON.parse(data.toString()) as Record<string, unknown>);
        if (frame?.type === "tunnel.open") {
          socket.send(JSON.stringify({ type: "tunnel.opened", tunnelId: frame.tunnelId }));
        }
      });
      await new Promise((resolve) => socket.once("open", resolve));
      socket.send(
        JSON.stringify({
          type: "hello",
          protocolVersion: 1,
          daemonVersion: "old",
          workdir: "/w",
          capabilities: ["tunnel"],
        }),
      );
      await eventually(() => hub.isConnected(sandboxId));

      const handle = await hub.tunnel(sandboxId).open(1);
      await handle.write("hello");
      await eventually(() => received.some((frame) => frame.type === "tunnel.data"));
      expect(received.some((frame) => frame.binary)).toBe(false);
      handle.close();
    }, 30_000);
  });

  describe("a malformed or unwanted binary message", () => {
    /** A hub, and a daemon that is really a socket we control, which says it can take binary. */
    async function rogueDaemon(hubOptions: { binaryData?: boolean } = {}) {
      const hubPort = await freePort();
      const hub = new RemoteSandboxHub({
        authorize: (candidate) => (candidate === token ? { sandboxId } : null),
        connectTimeoutMs: 5_000,
        ...hubOptions,
      });
      cleanups.push(() => hub.close());
      await hub.listen({ host: "127.0.0.1", port: hubPort });
      const socket = new WebSocket(`ws://127.0.0.1:${hubPort}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      cleanups.push(() => socket.terminate());
      const closed = new Promise<number>((resolve) => socket.once("close", resolve));
      await new Promise((resolve) => socket.once("open", resolve));
      socket.send(
        JSON.stringify({
          type: "hello",
          protocolVersion: 1,
          daemonVersion: "rogue",
          workdir: "/w",
          capabilities: ["tunnel", "binary-data"],
        }),
      );
      await eventually(() => hub.isConnected(sandboxId));
      return { hub, socket, closed };
    }

    it("makes the hub drop a daemon that sends garbage as binary", async () => {
      const { socket, closed } = await rogueDaemon();
      socket.send(Buffer.from([1, 0, 0]), { binary: true });
      expect(await closed).toBe(1002);
    });

    it("makes the hub drop a daemon that sends binary it never agreed to", async () => {
      const { socket, closed } = await rogueDaemon({ binaryData: false });
      // Well formed, but the hub did not say it could take binary.
      const frame = Buffer.concat([Buffer.from([1, 1, 0x74, 0, 0, 0, 0]), Buffer.from("x")]);
      socket.send(frame, { binary: true });
      expect(await closed).toBe(1002);
    });

    it("answers a hub's garbage with an error frame, and stays connected", async () => {
      const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
      cleanups.push(() => void server.close());
      await new Promise((resolve) => server.once("listening", resolve));
      const { port } = server.address() as net.AddressInfo;
      const replies: Array<{ type: string }> = [];
      let hello: { capabilities?: string[] } | undefined;
      server.on("connection", (socket) => {
        socket.once("message", (data) => {
          hello = JSON.parse(data.toString());
          socket.send(
            JSON.stringify({
              type: "welcome",
              protocolVersion: 1,
              heartbeatIntervalMs: 60_000,
              capabilities: ["tunnel", "binary-data"],
            }),
          );
          socket.on("message", (reply, binary) => {
            if (!binary) replies.push(JSON.parse(reply.toString()));
          });
          // Wrong kind byte (a to-hub frame), then too short.
          setTimeout(() => {
            socket.send(Buffer.from([1, 1, 0x74, 0, 0, 0, 0, 5]), { binary: true });
            socket.send(Buffer.from([2]), { binary: true });
          }, 100);
        });
      });
      const h = await createRemoteHarness({ connect: false });
      cleanups.push(() => h.cleanup());
      await h.daemon.stop();
      const daemon = new SandboxDaemon({
        controlUrl: `ws://127.0.0.1:${port}`,
        token,
        workdir: h.workdir,
        stateDir: h.stateDir,
        terminal: false,
        desktop: false,
      });
      cleanups.push(() => daemon.stop());
      daemon.start();
      await daemon.ready();

      await eventually(() => replies.filter((reply) => reply.type === "error").length >= 2);
      expect(hello?.capabilities).toContain("binary-data");
      expect(daemon.connected).toBe(true);
    }, 30_000);
  });

  describe("through the relay's input filter", () => {
    const bytes = (...values: number[]) => Uint8Array.from(values);
    const join = (...parts: Uint8Array[]) => Uint8Array.from(parts.flatMap((part) => [...part]));
    const handshake = join(new TextEncoder().encode("RFB 003.008\n"), bytes(1), bytes(1));
    const setEncodings = bytes(2, 0, 0, 1, 0, 0, 0, 16);
    const updateRequest = bytes(3, 1, 0, 0, 0, 0, 3, 0, 2, 0);
    const keyEvent = bytes(4, 1, 0, 0, 0, 0, 0, 0x61);
    const pointerEvent = bytes(5, 1, 0, 10, 0, 20);

    it("still drops a viewer's input before it crosses a binary link, and passes the rest", async () => {
      const atService: number[] = [];
      const port = await listen((socket) => {
        socket.on("data", (chunk) => {
          atService.push(...chunk);
          socket.write(chunk);
        });
      });
      const { h, recorder } = await recorded();
      let mayType = false;
      const filter = new RfbClientFilter(() => mayType);

      // What a hub does for a browser: a WebSocket on one side, a tunnel on the other.
      const server = http.createServer();
      const sockets = new WebSocketServer({ server });
      sockets.on("connection", (ws) => {
        bridgeTunnel(ws, h.hub.tunnel(sandboxId).open(port, { profile: "interactive" }), {
          filter: (chunk) => filter.push(chunk),
        });
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
      cleanups.push(async () => {
        for (const client of sockets.clients) client.terminate();
        sockets.close();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      });
      const { port: relayPort } = server.address() as net.AddressInfo;

      const browser = new WebSocket(`ws://127.0.0.1:${relayPort}`);
      cleanups.push(() => browser.terminate());
      const echoed: number[] = [];
      browser.on("message", (data, binary) => {
        if (binary) echoed.push(...(data as Buffer));
      });
      await new Promise((resolve) => browser.once("open", resolve));

      for (const message of [handshake, setEncodings, updateRequest, keyEvent, pointerEvent]) {
        browser.send(message, { binary: true });
      }
      const allowed = join(handshake, setEncodings, updateRequest);
      await eventually(() => echoed.length >= allowed.length);
      await sleep(200);
      // The service heard the handshake and the harmless requests, and nothing it could act on.
      expect(atService).toEqual([...allowed]);
      expect(echoed).toEqual([...allowed]);

      // Control moves to this viewer: now its input passes.
      mayType = true;
      browser.send(keyEvent, { binary: true });
      await eventually(() => atService.length >= allowed.length + keyEvent.length);
      expect(atService.slice(allowed.length)).toEqual([...keyEvent]);

      // All of it went over the daemon link as binary, none as base64.
      expect(recorder.binary("hub").bytes).toBeGreaterThanOrEqual(allowed.length + keyEvent.length);
      expect(recorder.text("hub", "tunnel.data")).toBe(0);
    }, 30_000);
  });
});
