import { createHash } from "node:crypto";
import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket, { WebSocketServer } from "ws";
import { RemoteSandboxHub, relayTicket, type TunnelHandle } from "../src/remote/index";
import {
  type RemoteHarness,
  type RemoteHarnessOptions,
  createRemoteHarness,
  eventually,
  sandboxId,
  token,
} from "./support/remote-harness";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const servers: net.Server[] = [];
const sockets: net.Socket[] = [];
const harnesses: RemoteHarness[] = [];
const hubs: RemoteSandboxHub[] = [];
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.destroy();
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
  await Promise.all(hubs.splice(0).map((hub) => hub.close()));
  await Promise.all(harnesses.splice(0).map((harness) => harness.cleanup()));
});

async function harness(options: RemoteHarnessOptions = {}) {
  const created = await createRemoteHarness(options);
  harnesses.push(created);
  return created;
}

/** Listen on a loopback port inside this test process, which is "the sandbox" for the daemon. */
async function listen(
  onConnection: (socket: net.Socket) => void,
  host = "127.0.0.1",
): Promise<{ server: net.Server; port: number }> {
  const server = net.createServer((socket) => {
    sockets.push(socket);
    socket.on("error", () => undefined);
    onConnection(socket);
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, () => resolve());
  });
  return { server, port: (server.address() as net.AddressInfo).port };
}

const echo = (socket: net.Socket) => socket.pipe(socket);

/** Read from a handle until `predicate` says the text so far is enough. */
async function readUntil(handle: TunnelHandle, enough: (text: string) => boolean) {
  let text = "";
  const decoder = new TextDecoder();
  for await (const chunk of handle.output) {
    text += decoder.decode(chunk, { stream: true });
    if (enough(text)) return text;
  }
  throw new Error(`stream ended early: ${text}`);
}

describe("tunnel", () => {
  it("round-trips bytes to a service on the sandbox's loopback", async () => {
    const { port } = await listen(echo);
    const h = await harness();
    const handle = await h.hub.tunnel(sandboxId).open(port);
    expect(handle.port).toBe(port);

    await handle.write("hello ");
    await handle.write(new TextEncoder().encode("tunnel"));
    expect(await readUntil(handle, (text) => text === "hello tunnel")).toBe("hello tunnel");
    handle.close();
    expect(await handle.exit).toEqual({ reason: "closed" });
  });

  it("falls back to ::1 when nothing listens on 127.0.0.1", async () => {
    let v6: { port: number };
    try {
      v6 = await listen(echo, "::1");
    } catch {
      return; // No IPv6 loopback here.
    }
    const h = await harness();
    const handle = await h.hub.tunnel(sandboxId).open(v6.port);
    await handle.write("v6");
    expect(await readUntil(handle, (text) => text === "v6")).toBe("v6");
    handle.close();
  });

  it("reports how the tunnel ended", async () => {
    const { port } = await listen((socket) => socket.end("bye"));
    const h = await harness();
    const handle = await h.hub.tunnel(sandboxId).open(port);
    expect(await readUntil(handle, (text) => text === "bye")).toBe("bye");
    expect(await handle.exit).toEqual({ reason: "remote" });
    await expect(handle.write("late")).rejects.toMatchObject({ code: "invalid_state" });
  });

  it("ends tunnels as disconnected when the link drops", async () => {
    const { port } = await listen(echo);
    const h = await harness();
    const handle = await h.hub.tunnel(sandboxId).open(port);
    await h.hub.close();
    expect(await handle.exit).toMatchObject({ reason: "disconnected" });
  });

  it("refuses a port nothing listens on, with a typed error", async () => {
    const { port, server } = await listen(echo);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    servers.splice(servers.indexOf(server), 1);
    const h = await harness();
    await expect(h.hub.tunnel(sandboxId).open(port)).rejects.toMatchObject({ code: "port" });
  });

  it("caps how many tunnels a connection holds", async () => {
    const { port } = await listen(echo);
    const h = await harness({ daemon: { tunnel: { maxTunnels: 2 } } });
    const tunnel = h.hub.tunnel(sandboxId);
    const first = await tunnel.open(port);
    await tunnel.open(port);
    await expect(tunnel.open(port)).rejects.toMatchObject({ code: "invalid_state" });
    first.close();
    await eventually(async () => {
      try {
        (await tunnel.open(port)).close();
        return true;
      } catch {
        return false;
      }
    });
  });

  describe("flow control", () => {
    it("moves a large transfer through a slow consumer without being cut off", async () => {
      const total = 16 * 1024 * 1024;
      const expected = createHash("sha256");
      let backpressured = 0;
      const { port } = await listen((socket) => {
        let sent = 0;
        const pump = () => {
          while (sent < total) {
            const size = Math.min(64 * 1024, total - sent);
            const chunk = Buffer.alloc(size, sent % 251);
            sent += size;
            expected.update(chunk);
            if (!socket.write(chunk)) {
              backpressured += 1;
              socket.once("drain", pump);
              return;
            }
          }
          socket.end();
        };
        pump();
      });
      const h = await harness({ hub: { maxTunnelBufferBytes: 1024 * 1024 } });
      const handle = await h.hub.tunnel(sandboxId).open(port);

      const received = createHash("sha256");
      let bytes = 0;
      let chunks = 0;
      for await (const chunk of handle.output) {
        received.update(chunk);
        bytes += chunk.byteLength;
        // A consumer that is slower than the service.
        if ((chunks += 1) % 4 === 0) await sleep(1);
      }
      expect(bytes).toBe(total);
      expect(received.digest("hex")).toBe(expected.digest("hex"));
      expect(await handle.exit).toEqual({ reason: "remote" });
      // The service had to wait for the consumer, so the data was not read ahead into memory.
      expect(backpressured).toBeGreaterThan(0);
    }, 60_000);

    it("stops reading from a service when nobody reads the tunnel", async () => {
      let accepted = 0;
      const { port } = await listen((socket) => {
        const pump = () => {
          while (true) {
            const chunk = Buffer.alloc(64 * 1024, 1);
            if (!socket.write(chunk)) {
              accepted += chunk.byteLength;
              socket.once("drain", pump);
              return;
            }
            accepted += chunk.byteLength;
          }
        };
        pump();
      });
      const h = await harness({ hub: { maxTunnelBufferBytes: 1024 * 1024 } });
      const handle = await h.hub.tunnel(sandboxId).open(port);
      let exited = false;
      void handle.exit.then(() => (exited = true));

      // Never read handle.output. Without flow control the daemon would drain the service.
      await sleep(1_500);
      const first = accepted;
      await sleep(500);
      expect(exited).toBe(false);
      expect(accepted).toBeLessThan(24 * 1024 * 1024);
      expect(accepted - first).toBeLessThan(1024 * 1024);
      expect((await h.runtime.exec({ command: "true" })).status).toBe("exited");
      handle.close();
    }, 30_000);

    it("makes writes wait while the service is not reading", async () => {
      let received = 0;
      let socketRef: net.Socket | undefined;
      const { port } = await listen((socket) => {
        socketRef = socket;
        socket.pause();
        socket.on("data", (chunk) => (received += chunk.byteLength));
      });
      const h = await harness();
      const handle = await h.hub.tunnel(sandboxId).open(port);

      const total = 16 * 1024 * 1024;
      let finished = false;
      const upload = handle.write(new Uint8Array(total)).then(() => (finished = true));
      await sleep(800);
      expect(finished).toBe(false);
      expect(received).toBe(0);

      socketRef?.resume();
      await upload;
      await eventually(() => received === total);
      handle.close();
    }, 30_000);

    it("does not delay a concurrent exec or the heartbeat while a tunnel floods", async () => {
      const { port } = await listen((socket) => {
        const pump = () => {
          while (socket.write(Buffer.alloc(64 * 1024, 7))) continue;
          socket.once("drain", pump);
        };
        pump();
      });
      const h = await harness({ hub: { heartbeatIntervalMs: 200 } });
      const handle = await h.hub.tunnel(sandboxId).open(port);
      let bytes = 0;
      void (async () => {
        for await (const chunk of handle.output) bytes += chunk.byteLength;
      })();
      await eventually(() => bytes > 1024 * 1024, 10_000);

      const started = Date.now();
      let slowest = 0;
      while (Date.now() - started < 2_000) {
        const before = Date.now();
        const result = await h.runtime.exec({ command: "echo", args: ["alive"] });
        slowest = Math.max(slowest, Date.now() - before);
        expect(result).toMatchObject({ status: "exited", exitCode: 0 });
      }
      expect(h.hub.isConnected(sandboxId)).toBe(true);
      expect(slowest).toBeLessThan(1_000);
      handle.close();
    }, 30_000);
  });

  describe("policy", () => {
    it("only reaches the ports the daemon allows", async () => {
      const allowed = await listen(echo);
      const other = await listen(echo);
      const h = await harness({ daemon: { tunnel: { allowedPorts: [allowed.port] } } });
      const tunnel = h.hub.tunnel(sandboxId);

      (await tunnel.open(allowed.port)).close();
      await expect(tunnel.open(other.port)).rejects.toMatchObject({
        code: "port",
        message: expect.stringContaining("not allowed"),
      });
    });

    it("never takes a host outside loopback", async () => {
      const h = await harness();
      const tunnel = h.hub.tunnel(sandboxId);
      await expect(tunnel.open(80, { host: "10.0.0.1" as "127.0.0.1" })).rejects.toThrow(TypeError);
      await expect(tunnel.open(80, { host: "example.com" as "127.0.0.1" })).rejects.toThrow(
        TypeError,
      );
      await expect(tunnel.open(0)).rejects.toThrow(RangeError);
      await expect(tunnel.open(70_000)).rejects.toThrow(RangeError);
    });

    it("refuses a non-loopback host on the wire too, and answers instead of hanging", async () => {
      const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
      await new Promise((resolve) => server.once("listening", resolve));
      const { port } = server.address() as { port: number };
      const received: Array<{ type: string; requestId?: string; code?: string }> = [];
      server.on("connection", (socket) => {
        socket.once("message", () => {
          socket.send(
            JSON.stringify({ type: "welcome", protocolVersion: 1, heartbeatIntervalMs: 60_000 }),
          );
          socket.on("message", (data) => received.push(JSON.parse(data.toString())));
          socket.send(
            JSON.stringify({ type: "tunnel.open", tunnelId: "t1", port: 1234, host: "10.0.0.1" }),
          );
          // The same fast failure applies to terminals: an invalid open must not strand its caller.
          socket.send(
            JSON.stringify({
              type: "pty.open",
              ptyId: "p1",
              sessionName: "bad name!",
              cols: 80,
              rows: 24,
            }),
          );
        });
      });
      const h = await harness({ connect: false });
      await h.daemon.stop();
      const daemon = h.startDaemon({ controlUrl: `ws://127.0.0.1:${port}` });
      try {
        await eventually(() => received.filter((frame) => frame.type === "error").length === 2);
        const ids = received.filter((frame) => frame.type === "error").map((f) => f.requestId);
        expect(ids.sort()).toEqual(["p1", "t1"]);
      } finally {
        await daemon.stop();
        server.close();
      }
    });
  });

  describe("capability negotiation", () => {
    it("fails with a typed error when the daemon has tunnels switched off", async () => {
      const h = await harness({ daemon: { tunnel: false } });
      await expect(h.hub.tunnel(sandboxId).open(1234)).rejects.toMatchObject({
        code: "unsupported",
      });
      expect((await h.runtime.exec({ command: "true" })).status).toBe("exited");
    });

    it("fails with a typed error against a daemon that predates tunnels", async () => {
      const hub = new RemoteSandboxHub({
        authorize: (candidate) => (candidate === token ? { sandboxId } : null),
        connectTimeoutMs: 2_000,
      });
      hubs.push(hub);
      const { port } = await hub.listen({ host: "127.0.0.1" });
      const socket = new WebSocket(`ws://127.0.0.1:${port}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      const received: Array<{ type: string }> = [];
      socket.on("message", (data) => received.push(JSON.parse(data.toString())));
      await new Promise<void>((resolve) =>
        socket.once("open", () => {
          socket.send(
            JSON.stringify({
              type: "hello",
              protocolVersion: 1,
              daemonVersion: "old",
              workdir: "/w",
            }),
          );
          resolve();
        }),
      );
      await eventually(() => hub.isConnected(sandboxId));
      await expect(hub.tunnel(sandboxId).open(1234)).rejects.toMatchObject({ code: "unsupported" });
      await sleep(100);
      expect(received.filter((frame) => frame.type.startsWith("tunnel."))).toEqual([]);
      socket.close();
    });
  });
});

describe("browser tunnel relay", () => {
  const origin = "https://app.example";

  async function relay(options: { port: number; daemon?: RemoteHarnessOptions["daemon"] }) {
    const harnessOptions: RemoteHarnessOptions = {
      listen: { tunnelPath: "/tunnel" },
      hub: {
        allowedOrigins: [origin],
        authorizeTunnel: (request) =>
          relayTicket(request) === "ok" ? { sandboxId, port: options.port } : null,
      },
    };
    if (options.daemon !== undefined) harnessOptions.daemon = options.daemon;
    const h = await harness(harnessOptions);
    return { h, url: `ws://127.0.0.1:${h.port}/tunnel` };
  }

  function browser(url: string, options: { protocols?: string[]; origin?: string | null } = {}) {
    const clientOptions: WebSocket.ClientOptions = {};
    if (options.origin !== null) clientOptions.origin = options.origin ?? origin;
    const socket = new WebSocket(url, options.protocols ?? ["anvia.tunnel.v1"], clientOptions);
    const state = {
      output: Buffer.alloc(0),
      closed: undefined as { code: number; reason: string } | undefined,
    };
    socket.on("message", (data, isBinary) => {
      if (isBinary) state.output = Buffer.concat([state.output, data as Buffer]);
    });
    socket.on("close", (code, reason) => (state.closed = { code, reason: reason.toString() }));
    const refused = new Promise<number>((resolve) => {
      socket.once("unexpected-response", (_request, response) => resolve(response.statusCode ?? 0));
      socket.once("open", () => resolve(0));
      socket.once("error", () => undefined);
    });
    return { socket, state, refused };
  }

  it("refuses a missing or unknown ticket with 401", async () => {
    const { port } = await listen(echo);
    const { url } = await relay({ port });
    expect(await browser(url).refused).toBe(401);
    expect(await browser(`${url}?ticket=wrong`).refused).toBe(401);
    expect(
      await browser(url, { protocols: ["anvia.tunnel.v1", "anvia.ticket.wrong"] }).refused,
    ).toBe(401);
  });

  it("refuses a foreign Origin with 403 even with a valid ticket", async () => {
    const { port } = await listen(echo);
    const { url } = await relay({ port });
    expect(await browser(`${url}?ticket=ok`, { origin: "https://evil.example" }).refused).toBe(403);
  });

  it("answers 404 when the hub has no tunnel authorizer", async () => {
    const h = await harness({ listen: { tunnelPath: "/tunnel" } });
    expect(await browser(`ws://127.0.0.1:${h.port}/tunnel?ticket=ok`).refused).toBe(404);
  });

  it("relays bytes both ways, with the ticket in the query or as a subprotocol", async () => {
    const { port } = await listen(echo);
    const { url } = await relay({ port });
    for (const viewer of [
      browser(`${url}?ticket=ok`),
      // noVNC offers `binary`; the ticket rides along as a second subprotocol.
      browser(url, { protocols: ["binary", "anvia.ticket.ok"] }),
    ]) {
      expect(await viewer.refused).toBe(0);
      viewer.socket.send(Buffer.from([1, 2, 3, 250]));
      await eventually(() => viewer.state.output.equals(Buffer.from([1, 2, 3, 250])));
      viewer.socket.close();
    }
  });

  it("closes the service's connection when the browser leaves", async () => {
    let serverClosed = false;
    const { port } = await listen((socket) => {
      socket.on("close", () => (serverClosed = true));
      socket.resume();
    });
    const { url } = await relay({ port });
    const viewer = browser(`${url}?ticket=ok`);
    await viewer.refused;
    viewer.socket.send(Buffer.from("hi"));
    await sleep(100);
    viewer.socket.close();
    await eventually(() => serverClosed);
  });

  it("closes the browser when the service hangs up", async () => {
    const { port } = await listen((socket) => socket.end("done"));
    const { url } = await relay({ port });
    const viewer = browser(`${url}?ticket=ok`);
    await viewer.refused;
    await eventually(() => viewer.state.closed !== undefined);
    expect(viewer.state.closed?.code).toBe(1000);
    expect(viewer.state.output.toString()).toBe("done");
  });

  it("reports a refused port or a daemon without tunnels as a typed close reason", async () => {
    const dead = await listen(echo);
    await new Promise<void>((resolve) => dead.server.close(() => resolve()));
    servers.splice(servers.indexOf(dead.server), 1);
    const refusedPort = await relay({ port: dead.port });
    const first = browser(`${refusedPort.url}?ticket=ok`);
    await first.refused;
    await eventually(() => first.state.closed !== undefined);
    expect(first.state.closed?.code).toBe(1011);
    expect(first.state.closed?.reason).toMatch(/^port:/);

    const live = await listen(echo);
    const unsupported = await relay({ port: live.port, daemon: { tunnel: false } });
    const second = browser(`${unsupported.url}?ticket=ok`);
    await second.refused;
    await eventually(() => second.state.closed !== undefined);
    expect(second.state.closed?.reason).toMatch(/^unsupported:/);
  });

  it("closes a socket that sends text instead of bytes", async () => {
    const { port } = await listen(echo);
    const { url } = await relay({ port });
    const viewer = browser(`${url}?ticket=ok`);
    await viewer.refused;
    viewer.socket.send("not bytes");
    await eventually(() => viewer.state.closed !== undefined);
    expect(viewer.state.closed?.code).toBe(1003);
  });
});
