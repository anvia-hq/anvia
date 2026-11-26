import { access, readFile, writeFile } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket, { WebSocketServer } from "ws";
import { SandboxDaemon } from "../src/daemon/index";
import { HubConnection, LinkClosedError } from "../src/remote/connection";
import {
  RemoteSandboxHub,
  SandboxError,
  createRelayTicketStore,
  isSandboxError,
} from "../src/remote/index";
import { RemoteSandboxRuntime } from "../src/remote/runtime";
import {
  type RemoteHarness,
  createRemoteHarness,
  eventually,
  sandboxId,
  token,
} from "./support/remote-harness";

const decoder = new TextDecoder();
const text = (bytes: Uint8Array) => decoder.decode(bytes);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const harnesses: RemoteHarness[] = [];
const hubs: RemoteSandboxHub[] = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(hubs.splice(0).map((hub) => hub.close()));
  await Promise.all(harnesses.splice(0).map((harness) => harness.cleanup()));
});

async function harness(options?: Parameters<typeof createRemoteHarness>[0]) {
  const created = await createRemoteHarness(options);
  harnesses.push(created);
  return created;
}

function newHub(options: ConstructorParameters<typeof RemoteSandboxHub>[0]) {
  const hub = new RemoteSandboxHub(options);
  hubs.push(hub);
  return hub;
}

const authorize = (candidate: string) => (candidate === token ? { sandboxId } : null);

async function exists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function lines(target: string): Promise<string[]> {
  try {
    return (await readFile(target, "utf8")).split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

describe.skipIf(process.platform === "win32")("remote sandbox", () => {
  describe("reconnecting to a restarted hub", () => {
    it("keeps a process and its logs across a hub restart", async () => {
      const h = await harness();
      const started = await h.runtime.startProcess({
        command: "sh",
        args: ["-c", "echo before; sleep 0.6; echo after; sleep 30"],
      });
      await eventually(async () =>
        text((await h.runtime.readProcessLogs({ processId: started.id })).stdout).includes(
          "before",
        ),
      );

      await h.hub.close();
      await eventually(() => !h.daemon.connected);
      await sleep(900);

      const hub2 = newHub({ authorize, connectTimeoutMs: 5_000 });
      await hub2.listen({ host: "127.0.0.1", port: h.port });
      const runtime2 = hub2.runtime(sandboxId);

      const listed = await runtime2.listProcesses();
      expect(listed).toHaveLength(1);
      expect(listed[0]).toMatchObject({ id: started.id, status: "running" });

      const logs = await runtime2.readProcessLogs({ processId: started.id });
      expect(text(logs.stdout)).toBe("before\nafter\n");

      const stopped = await runtime2.stopProcess({ processId: started.id, gracePeriodMs: 300 });
      expect(stopped.status).toBe("stopped");
    });

    it("lets a retried operation finish once on the new hub", async () => {
      const h = await harness();
      const marker = path.join(h.workdir, "marker.txt");
      const command = {
        command: "sh",
        args: ["-c", "sleep 0.5; echo ran >> marker.txt; echo done"],
        operationId: "op-across-restart",
      };

      const first = h.runtime.exec(command);
      first.catch(() => undefined);
      await sleep(100);
      await h.hub.close();
      await expect(first).rejects.toMatchObject({ code: "sandbox_unavailable" });

      const hub2 = newHub({ authorize, connectTimeoutMs: 5_000 });
      await hub2.listen({ host: "127.0.0.1", port: h.port });
      const retried = await hub2.runtime(sandboxId).exec(command);

      expect(retried).toMatchObject({ status: "exited", exitCode: 0 });
      expect(text(retried.stdout)).toBe("done\n");
      await sleep(200);
      expect(await lines(marker)).toEqual(["ran"]);
    });
  });

  describe("operationId", () => {
    it("executes a repeated operation once and returns the original result", async () => {
      const h = await harness();
      const request = {
        command: "sh",
        args: ["-c", "echo x >> counter.txt; echo $$"],
        operationId: "op-1",
      };
      const first = await h.runtime.exec(request);
      const second = await h.runtime.exec(request);

      expect(await lines(path.join(h.workdir, "counter.txt"))).toEqual(["x"]);
      expect(text(second.stdout)).toBe(text(first.stdout));
      expect(second).toEqual(first);

      await h.runtime.exec({ ...request, operationId: "op-2" });
      expect(await lines(path.join(h.workdir, "counter.txt"))).toEqual(["x", "x"]);
    });

    it("runs operations without an id every time", async () => {
      const h = await harness();
      const request = { command: "sh", args: ["-c", "echo x >> plain.txt"] };
      await h.runtime.exec(request);
      await h.runtime.exec(request);
      expect(await lines(path.join(h.workdir, "plain.txt"))).toEqual(["x", "x"]);
    });

    it("joins a duplicate that arrives while the first attempt is running", async () => {
      const h = await harness();
      const request = {
        command: "sh",
        args: ["-c", "sleep 0.3; echo x >> concurrent.txt"],
        operationId: "op-concurrent",
      };
      const [a, b] = await Promise.all([h.runtime.exec(request), h.runtime.exec(request)]);
      expect(a).toEqual(b);
      expect(await lines(path.join(h.workdir, "concurrent.txt"))).toEqual(["x"]);
    });

    it("deduplicates every kind of mutation", async () => {
      const h = await harness();
      const write = { path: "w.txt", text: "one", operationId: "op-write" };
      await h.runtime.writeTextFile(write);
      await writeFile(path.join(h.workdir, "w.txt"), "tampered");
      await h.runtime.writeTextFile(write);
      expect(await readFile(path.join(h.workdir, "w.txt"), "utf8")).toBe("tampered");

      const start = { command: "sleep", args: ["30"], operationId: "op-start" };
      const one = await h.runtime.startProcess(start);
      const two = await h.runtime.startProcess(start);
      expect(two).toEqual(one);
      expect(await h.runtime.listProcesses()).toHaveLength(1);

      const stop = { processId: one.id, gracePeriodMs: 200, operationId: "op-stop" };
      const stopped = await h.runtime.stopProcess(stop);
      expect(await h.runtime.stopProcess(stop)).toEqual(stopped);
    });

    it("rejects an id reused for a different request", async () => {
      const h = await harness();
      await h.runtime.exec({ command: "true", operationId: "op-reuse" });
      await expect(
        h.runtime.exec({ command: "false", operationId: "op-reuse" }),
      ).rejects.toMatchObject({ code: "invalid_state" });
    });

    it("does not remember failures or cancellations", async () => {
      const h = await harness();
      const controller = new AbortController();
      const request = {
        command: "sh",
        args: ["-c", "sleep 0.4; echo x >> retry.txt"],
        operationId: "op-cancelled",
      };
      const cancelled = h.runtime.exec({ ...request, abortSignal: controller.signal });
      setTimeout(() => controller.abort(new Error("cancelled")), 100);
      await expect(cancelled).rejects.toThrow("cancelled");

      await h.runtime.exec(request);
      expect(await lines(path.join(h.workdir, "retry.txt"))).toEqual(["x"]);
    });

    it("survives a daemon restart through the on-disk table", async () => {
      const h = await harness();
      const request = {
        command: "sh",
        args: ["-c", "echo x >> durable.txt"],
        operationId: "op-durable",
      };
      await h.runtime.exec(request);
      await h.daemon.stop();

      const restarted = h.startDaemon();
      await restarted.ready();
      await h.runtime.exec(request);
      expect(await lines(path.join(h.workdir, "durable.txt"))).toEqual(["x"]);
    });

    it("does not replay a process operation after the daemon restarts", async () => {
      const h = await harness();
      const request = {
        command: "sh",
        args: ["-c", "sleep 30"],
        operationId: "op-process",
      };
      const first = await h.runtime.startProcess(request);
      expect(await h.runtime.startProcess(request)).toEqual(first);
      await h.daemon.stop();

      const restarted = h.startDaemon();
      await restarted.ready();
      const second = await h.runtime.startProcess(request);
      const listed = await h.runtime.listProcesses();
      expect(listed.map((process) => process.id)).toEqual([second.id]);
      expect(listed[0]?.status).toBe("running");
      await h.runtime.stopProcess({ processId: second.id, gracePeriodMs: 100 });
    });

    it("validates the id", async () => {
      const h = await harness();
      await expect(h.runtime.exec({ command: "true", operationId: "" })).rejects.toThrow(
        "operationId",
      );
    });
  });

  describe("cancellation", () => {
    it("kills the command on the daemon when the caller aborts", async () => {
      const h = await harness();
      const controller = new AbortController();
      const pending = h.runtime.exec({
        command: "sh",
        args: ["-c", "sleep 1; touch sentinel"],
        abortSignal: controller.signal,
      });
      setTimeout(() => controller.abort(new Error("stop")), 150);
      await expect(pending).rejects.toThrow("stop");
      await sleep(1_300);
      expect(await exists(path.join(h.workdir, "sentinel"))).toBe(false);
    });

    it("kills the whole process group, including background children", async () => {
      const h = await harness();
      const result = await h.runtime.exec({
        command: "sh",
        args: ["-c", "(sleep 1; touch orphan) & sleep 30"],
        timeoutMs: 200,
      });
      expect(result.status).toBe("timed_out");
      await sleep(1_300);
      expect(await exists(path.join(h.workdir, "orphan"))).toBe(false);
    });

    it("stops a stream when the consumer leaves early", async () => {
      const h = await harness();
      for await (const event of h.runtime.execStream({
        command: "sh",
        args: ["-c", "echo first; sleep 1; touch streamed"],
      })) {
        if (event.type === "stdout") break;
      }
      await sleep(1_300);
      expect(await exists(path.join(h.workdir, "streamed"))).toBe(false);
    });

    it("aborts while waiting for a daemon that is not connected", async () => {
      const hub = newHub({ authorize, connectTimeoutMs: 5_000 });
      const controller = new AbortController();
      const pending = hub.runtime(sandboxId).exec({
        command: "true",
        abortSignal: controller.signal,
      });
      setTimeout(() => controller.abort(new Error("gave up")), 100);
      await expect(pending).rejects.toThrow("gave up");
    });
  });

  describe("timeouts", () => {
    it("fails with sandbox_unavailable when no daemon connects in time", async () => {
      const hub = newHub({ authorize, connectTimeoutMs: 120 });
      const startedAt = Date.now();
      await expect(hub.runtime(sandboxId).listFiles()).rejects.toMatchObject({
        code: "sandbox_unavailable",
      });
      expect(Date.now() - startedAt).toBeLessThan(2_000);
    });

    it("applies the daemon's default command timeout", async () => {
      const h = await harness({ limits: { commandTimeoutMs: 250 } });
      const result = await h.runtime.exec({ command: "sleep", args: ["10"] });
      expect(result.status).toBe("timed_out");
    });

    it("waits for a late daemon within the connect timeout", async () => {
      const hub = newHub({ authorize, connectTimeoutMs: 5_000 });
      const { port } = await hub.listen({ host: "127.0.0.1" });
      const pending = hub.runtime(sandboxId).exec({ command: "echo", args: ["late"] });
      await sleep(200);
      const root = await createRemoteHarness({ connect: false });
      harnesses.push(root);
      const daemon = new SandboxDaemon({
        controlUrl: `ws://127.0.0.1:${port}`,
        token,
        workdir: root.workdir,
        stateDir: root.stateDir,
        reconnect: { initialDelayMs: 25 },
      });
      try {
        daemon.start();
        expect(text((await pending).stdout)).toBe("late\n");
      } finally {
        await daemon.stop();
      }
    });
  });

  describe("connection handling", () => {
    it("refuses daemons the hub does not authorize", async () => {
      const seen: string[] = [];
      const hub = newHub({
        authorize: (candidate) => {
          seen.push(candidate);
          return null;
        },
      });
      const { port } = await hub.listen({ host: "127.0.0.1" });
      const h = await harness({ connect: false });
      const logs: string[] = [];
      const daemon = new SandboxDaemon({
        controlUrl: `ws://127.0.0.1:${port}`,
        token: "wrong",
        workdir: h.workdir,
        stateDir: h.stateDir,
        reconnect: { initialDelayMs: 25, maxDelayMs: 50 },
        onLog: (_, message) => logs.push(message),
      });
      try {
        daemon.start();
        await eventually(() => logs.some((entry) => entry.includes("HTTP 401")));
        expect(seen[0]).toBe("wrong");
        expect(hub.connected()).toEqual([]);
        expect(daemon.connected).toBe(false);
        expect(logs.join("\n")).not.toContain("wrong");
      } finally {
        await daemon.stop();
      }
    });

    it("answers 500 when authorize throws and never connects", async () => {
      const hub = newHub({
        authorize: () => {
          throw new Error("auth backend down");
        },
      });
      const { port } = await hub.listen({ host: "127.0.0.1" });
      const status = await new Promise<number | undefined>((resolve) => {
        const socket = new WebSocket(`ws://127.0.0.1:${port}`, {
          headers: { authorization: "Bearer anything" },
        });
        socket.on("unexpected-response", (_, response) => resolve(response.statusCode));
        socket.on("error", () => undefined);
      });
      expect(status).toBe(500);
      expect(hub.connected()).toEqual([]);
    });

    it("rejects a missing token", async () => {
      const hub = newHub({ authorize });
      const { port } = await hub.listen({ host: "127.0.0.1" });
      const status = await new Promise<number | undefined>((resolve) => {
        const socket = new WebSocket(`ws://127.0.0.1:${port}`);
        socket.on("unexpected-response", (_, response) => resolve(response.statusCode));
        socket.on("error", () => undefined);
      });
      expect(status).toBe(401);
    });

    it("never hands the daemon's credentials to commands", async () => {
      const previous = {
        token: process.env.ANVIA_SANDBOX_TOKEN,
        url: process.env.ANVIA_CONTROL_URL,
      };
      process.env.ANVIA_SANDBOX_TOKEN = "secret-from-env";
      process.env.ANVIA_CONTROL_URL = "ws://secret-url";
      try {
        const h = await harness();
        const exec = await h.runtime.exec({ command: "env" });
        const process_ = await h.runtime.startProcess({ command: "env" });
        await sleep(200);
        const logs = await h.runtime.readProcessLogs({ processId: process_.id });
        for (const output of [text(exec.stdout), text(logs.stdout)]) {
          expect(output).not.toContain("secret-from-env");
          expect(output).not.toContain("secret-url");
          expect(output).not.toContain("ANVIA_SANDBOX_TOKEN");
        }
      } finally {
        if (previous.token === undefined) delete process.env.ANVIA_SANDBOX_TOKEN;
        else process.env.ANVIA_SANDBOX_TOKEN = previous.token;

        if (previous.url === undefined) delete process.env.ANVIA_CONTROL_URL;
        else process.env.ANVIA_CONTROL_URL = previous.url;
      }
    });

    it("lets a newer daemon take over, and the displaced one stops reconnecting", async () => {
      const h = await harness();
      const second = h.startDaemon();
      await second.ready();
      await eventually(() => !h.daemon.connected);
      await sleep(400);
      expect(h.daemon.connected).toBe(false);
      expect(second.connected).toBe(true);
      expect(h.hub.connected()).toEqual([sandboxId]);
      expect(h.logs.join("\n")).toContain("another daemon took over");
      await expect(h.runtime.exec({ command: "echo", args: ["ok"] })).resolves.toMatchObject({
        status: "exited",
      });
    });

    it("forgets a sandbox and disconnects its daemon", async () => {
      const h = await harness();
      const before = h.hub.runtime(sandboxId);
      expect(h.hub.isConnected(sandboxId)).toBe(true);

      h.hub.forget(sandboxId);
      expect(h.hub.isConnected(sandboxId)).toBe(false);
      expect(h.hub.runtime(sandboxId)).not.toBe(before);

      await eventually(() => h.hub.isConnected(sandboxId));
      expect(await h.hub.runtime(sandboxId).listFiles()).toEqual([]);
    });

    it("reports the daemon's workdir once connected", async () => {
      const h = await harness();
      expect(h.runtime.workdir).toBe(h.workdir);
      expect(h.runtime.provider).toBe("remote");
      expect(h.runtime.publishedPorts).toEqual([]);
    });

    it("emits onConnect, onDisconnect, onError and exposes capabilities and waitForConnection", async () => {
      const connectedEvents: Array<{ sandboxId: string; capabilities: readonly string[] }> = [];
      const disconnectedEvents: Array<{ sandboxId: string; replaced: boolean }> = [];
      const errors: Array<{ stage: string; sandboxId?: string }> = [];

      const hub = newHub({
        authorize: (candidate) => {
          if (candidate === "boom") throw new Error("db down");

          return candidate === token ? { sandboxId } : null;
        },
        onConnect: (event) =>
          connectedEvents.push({ sandboxId: event.sandboxId, capabilities: event.capabilities }),
        onDisconnect: (event) => disconnectedEvents.push(event),
        onError: (_error, context) => errors.push(context),
        connectTimeoutMs: 5_000,
      });
      const { port } = await hub.listen({ host: "127.0.0.1", path: "/daemon" });

      const status = await new Promise<number | undefined>((resolve) => {
        const socket = new WebSocket(`ws://127.0.0.1:${port}/daemon`, {
          headers: { authorization: "Bearer boom" },
        });
        socket.on("unexpected-response", (_, response) => resolve(response.statusCode));
        socket.on("error", () => undefined);
      });
      expect(status).toBe(500);
      expect(errors).toContainEqual({ stage: "authorize" });

      const root = await createRemoteHarness({ connect: false });
      harnesses.push(root);
      const waiting = hub.waitForConnection(sandboxId, { timeoutMs: 5_000 });
      expect(hub.capabilities(sandboxId)).toBeUndefined();

      await using daemon = new SandboxDaemon({
        controlUrl: `ws://127.0.0.1:${port}/daemon`,
        token,
        workdir: root.workdir,
        stateDir: root.stateDir,
        terminal: false,
        desktop: false,
      });
      daemon.start();
      await waiting;

      expect(connectedEvents).toHaveLength(1);
      expect(connectedEvents[0]?.sandboxId).toBe(sandboxId);
      expect(hub.capabilities(sandboxId)).toContain("tunnel");

      await daemon.stop();
      await eventually(() => disconnectedEvents.length > 0);
      expect(disconnectedEvents[0]).toEqual({ sandboxId, replaced: false });
      expect(hub.capabilities(sandboxId)).toBeUndefined();
    });

    it("attaches upgrade routing to an existing HTTP server without hijacking unrelated routes", async () => {
      const server = http.createServer();
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const { port } = server.address() as { port: number };
      const otherPaths: string[] = [];

      await using hub = new RemoteSandboxHub({ authorize, connectTimeoutMs: 5_000 });
      const detach = hub.attach(server, { path: "/daemon" });
      server.on("upgrade", (request, socket) => {
        const pathname = new URL(request.url ?? "/", "http://x").pathname;

        if (pathname !== "/daemon") {
          otherPaths.push(pathname);
          socket.write("HTTP/1.1 418 I'm a teapot\r\nConnection: close\r\n\r\n");
          socket.destroy();
        }
      });

      try {
        const otherStatus = await new Promise<number | undefined>((resolve) => {
          const socket = new WebSocket(`ws://127.0.0.1:${port}/other`);
          socket.on("unexpected-response", (_, response) => resolve(response.statusCode));
          socket.on("error", () => undefined);
        });
        expect(otherStatus).toBe(418);
        expect(otherPaths).toEqual(["/other"]);

        const root = await createRemoteHarness({ connect: false });
        harnesses.push(root);
        await using daemon = new SandboxDaemon({
          controlUrl: `ws://127.0.0.1:${port}/daemon`,
          token,
          workdir: root.workdir,
          stateDir: root.stateDir,
          terminal: false,
          desktop: false,
        });
        daemon.start();
        await hub.waitForConnection(sandboxId);
        expect(hub.isConnected(sandboxId)).toBe(true);
      } finally {
        detach();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });
  });

  describe("createRelayTicketStore and SandboxError helpers", () => {
    it("mints single-use expiring tickets, prunes expired entries, and supports redeemRequest", () => {
      let current = 1_000;
      const store = createRelayTicketStore<{ sandboxId: string }>({
        ttlMs: 500,
        maxEntries: 2,
        now: () => current,
      });

      const first = store.mint({ sandboxId: "a" });
      const second = store.mint({ sandboxId: "b" });
      expect(store.size).toBe(2);

      const third = store.mint({ sandboxId: "c" });
      expect(store.redeem(first)).toBeNull();
      expect(
        store.redeemRequest({
          headers: { "sec-websocket-protocol": `anvia.desktop.v1, anvia.ticket.${second}` },
          url: "/desktop",
        } as http.IncomingMessage),
      ).toEqual({ sandboxId: "b" });
      expect(store.redeem(second)).toBeNull();

      current += 600;
      expect(store.size).toBe(0);
      expect(store.redeem(third)).toBeNull();
    });

    it("exports SandboxError alias and isSandboxError type guard from remote", () => {
      const error = new SandboxError("locked", "desktop_locked");
      expect(isSandboxError(error)).toBe(true);
      expect(isSandboxError(error, "desktop_locked")).toBe(true);
      expect(isSandboxError(error, "timeout")).toBe(false);
      expect(isSandboxError(new Error("plain"))).toBe(false);
    });
  });

  describe("protocol", () => {
    async function rawClient(port: number) {
      const socket = new WebSocket(`ws://127.0.0.1:${port}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      await new Promise<void>((resolve, reject) => {
        socket.once("open", () => resolve());
        socket.once("error", reject);
      });
      const closed = new Promise<number>((resolve) =>
        socket.once("close", (code) => resolve(code)),
      );
      const messages: unknown[] = [];
      socket.on("message", (data) => messages.push(JSON.parse(data.toString())));
      return { socket, closed, messages };
    }

    it("rejects a daemon that speaks another protocol version", async () => {
      const hub = newHub({ authorize });
      const { port } = await hub.listen({ host: "127.0.0.1" });
      const { socket, closed } = await rawClient(port);
      socket.send(
        JSON.stringify({ type: "hello", protocolVersion: 99, daemonVersion: "x", workdir: "/w" }),
      );
      expect(await closed).toBe(1002);
      expect(hub.connected()).toEqual([]);
    });

    it("rejects a first frame that is not hello", async () => {
      const hub = newHub({ authorize });
      const { port } = await hub.listen({ host: "127.0.0.1" });
      const { socket, closed } = await rawClient(port);
      socket.send(JSON.stringify({ type: "ping" }));
      expect(await closed).toBe(1002);
    });

    it("drops a connection that never says hello", async () => {
      const hub = newHub({ authorize, handshakeTimeoutMs: 100 });
      const { port } = await hub.listen({ host: "127.0.0.1" });
      const { closed } = await rawClient(port);
      expect(await closed).toBe(1008);
    });

    it("closes a connection that sends an invalid frame after the handshake", async () => {
      const hub = newHub({ authorize });
      const { port } = await hub.listen({ host: "127.0.0.1" });
      const { socket, closed, messages } = await rawClient(port);
      socket.send(
        JSON.stringify({ type: "hello", protocolVersion: 1, daemonVersion: "x", workdir: "/w" }),
      );
      await eventually(() => messages.length > 0);
      expect(messages[0]).toMatchObject({ type: "welcome", protocolVersion: 1 });
      socket.send(JSON.stringify({ type: "response", requestId: 5 }));
      expect(await closed).toBe(1002);
    });

    it("drops a daemon that stops answering heartbeats", async () => {
      const hub = newHub({ authorize, heartbeatIntervalMs: 40 });
      const { port } = await hub.listen({ host: "127.0.0.1" });
      const { socket, closed, messages } = await rawClient(port);
      socket.send(
        JSON.stringify({ type: "hello", protocolVersion: 1, daemonVersion: "x", workdir: "/w" }),
      );
      await eventually(() => hub.isConnected(sandboxId));
      await closed;
      expect(messages.some((message) => (message as { type: string }).type === "ping")).toBe(true);
      expect(hub.isConnected(sandboxId)).toBe(false);
    });

    it("answers a malformed request with an error and keeps serving", async () => {
      const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
      await new Promise((resolve) => server.once("listening", resolve));
      const { port } = server.address() as { port: number };
      const received: Array<{ type: string; code?: string; requestId?: string }> = [];
      server.on("connection", (socket) => {
        socket.once("message", () => {
          socket.send(
            JSON.stringify({ type: "welcome", protocolVersion: 1, heartbeatIntervalMs: 60_000 }),
          );
          socket.on("message", (data) => received.push(JSON.parse(data.toString())));
          socket.send("not json");
          socket.send(
            JSON.stringify({ type: "request", requestId: "r1", method: "exec", params: {} }),
          );
          socket.send(
            JSON.stringify({
              type: "request",
              requestId: "r2",
              method: "futureMethod",
              params: {},
            }),
          );
          socket.send(JSON.stringify({ type: "ping" }));
        });
      });
      const h = await harness({ connect: false });
      await h.daemon.stop();
      const daemon = new SandboxDaemon({
        controlUrl: `ws://127.0.0.1:${port}`,
        token,
        workdir: h.workdir,
        stateDir: h.stateDir,
      });
      try {
        daemon.start();
        await eventually(() => received.some((frame) => frame.type === "pong"));
        const errors = received.filter((frame) => frame.type === "error");
        expect(errors).toHaveLength(3);
        expect(errors.find((frame) => frame.requestId === "r2")).toMatchObject({
          code: "protocol",
        });
        expect(daemon.connected).toBe(true);
      } finally {
        await daemon.stop();
        server.close();
      }
    });
  });

  describe("daemon operations", () => {
    it("waits for a TCP listener inside the sandbox", async () => {
      const h = await harness();
      const port = await freePort();
      await h.runtime.startProcess({
        command: process.execPath,
        args: [
          "-e",
          `setTimeout(() => require("net").createServer().listen(${port}, "127.0.0.1"), 250); setTimeout(() => {}, 20000)`,
        ],
      });
      await expect(
        h.runtime.waitForPort({ containerPort: port, timeoutMs: 5_000, intervalMs: 50 }),
      ).resolves.toEqual({ containerPort: port, protocol: "tcp" });
      await expect(
        h.runtime.waitForPort({ containerPort: await freePort(), timeoutMs: 250, intervalMs: 50 }),
      ).rejects.toMatchObject({ code: "timeout" });
    });

    it("moves a multi-megabyte file", async () => {
      const h = await harness();
      const data = Uint8Array.from({ length: 5 * 1024 * 1024 }, (_, index) => index % 251);
      await h.runtime.writeFile({ path: "large/blob.bin", data });
      const roundTripped = await h.runtime.readFile({ path: "large/blob.bin" });
      expect(Buffer.compare(roundTripped, data)).toBe(0);
    }, 30_000);

    it("refuses to read through a symlink that leaves the workspace", async () => {
      const h = await harness();
      await h.runtime.exec({
        command: "sh",
        args: [
          "-c",
          "mkdir -p /tmp/anvia-read-outside && echo secret > /tmp/anvia-read-outside/s.txt && ln -sfn /tmp/anvia-read-outside escape",
        ],
      });
      await expect(h.runtime.readFile({ path: "escape/s.txt" })).rejects.toMatchObject({
        code: "invalid_path",
      });
      await expect(h.runtime.listFiles({ path: "escape" })).rejects.toMatchObject({
        code: "invalid_path",
      });
    });

    it("turns a missing command into exit 127 and a bad cwd into exit 126", async () => {
      const h = await harness();
      expect(await h.runtime.exec({ command: "anvia-missing" })).toMatchObject({ exitCode: 127 });
      expect(await h.runtime.exec({ command: "true", cwd: "nope" })).toMatchObject({
        exitCode: 126,
      });
    });
  });
});

describe("RemoteSandboxRuntime retry rules", () => {
  function runtimeWith(calls: Array<() => Promise<unknown>>) {
    let index = 0;
    const connection = {
      call: async () => {
        const step = calls[Math.min(index, calls.length - 1)];
        index += 1;
        return step?.();
      },
    } as unknown as HubConnection;
    const runtime = new RemoteSandboxRuntime({
      id: "stub",
      source: { workdir: () => "/w", acquire: async () => connection },
    });
    return { runtime, attempts: () => index };
  }
  const lost = () => Promise.reject(new LinkClosedError());

  it("retries reads after a link loss", async () => {
    const { runtime, attempts } = runtimeWith([lost, async () => ({ processes: [] })]);
    await expect(runtime.listProcesses()).resolves.toEqual([]);
    expect(attempts()).toBe(2);
  });

  it("does not retry a mutation that has no operationId", async () => {
    const { runtime, attempts } = runtimeWith([lost, async () => ({})]);
    await expect(runtime.writeTextFile({ path: "a.txt", text: "x" })).rejects.toMatchObject({
      code: "sandbox_unavailable",
      message: expect.stringContaining("operationId"),
    });
    expect(attempts()).toBe(1);
  });

  it("retries a mutation that carries an operationId", async () => {
    const { runtime, attempts } = runtimeWith([lost, lost, async () => ({})]);
    await expect(
      runtime.writeTextFile({ path: "a.txt", text: "x", operationId: "op" }),
    ).resolves.toBeUndefined();
    expect(attempts()).toBe(3);
  });

  it("gives up after repeated link losses", async () => {
    const { runtime, attempts } = runtimeWith([lost]);
    await expect(runtime.listProcesses()).rejects.toMatchObject({ code: "sandbox_unavailable" });
    expect(attempts()).toBe(3);
  });

  it("does not retry sandbox errors", async () => {
    const { runtime, attempts } = runtimeWith([() => Promise.reject(new TypeError("bad request"))]);
    await expect(runtime.listProcesses()).rejects.toThrow("bad request");
    expect(attempts()).toBe(1);
  });
});

describe("HubConnection heartbeat", () => {
  function fakeSocket() {
    return Object.assign(new EventEmitter(), {
      readyState: WebSocket.OPEN as number,
      send: vi.fn(),
      close: vi.fn(),
      terminate: vi.fn(),
    });
  }

  it("pings open sockets and ignores ticks while closing", () => {
    vi.useFakeTimers();
    const openSocket = fakeSocket();
    const openConnection = new HubConnection(openSocket as unknown as WebSocket, "/w", 1_000);
    vi.advanceTimersByTime(2_000);
    expect(openSocket.send.mock.calls.map(([data]) => JSON.parse(String(data)).type)).toEqual([
      "ping",
      "ping",
    ]);
    openConnection.close(1000, "done");

    const closingSocket = fakeSocket();
    const closingConnection = new HubConnection(closingSocket as unknown as WebSocket, "/w", 1_000);
    closingSocket.readyState = WebSocket.CLOSING;
    expect(() => vi.advanceTimersByTime(3_000)).not.toThrow();
    expect(closingSocket.send).not.toHaveBeenCalled();
    closingConnection.close(1000, "done");
  });
});

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}
