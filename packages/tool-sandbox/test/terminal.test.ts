import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket, { WebSocketServer } from "ws";
import { SandboxDaemon } from "../src/daemon/index";
import { detectTmux } from "../src/daemon/terminal/manager";
import { loadNodePty } from "../src/daemon/terminal/pty";
import { RemoteSandboxHub, type TerminalHandle, terminalTicket } from "../src/remote/index";
import { fakeSpawner } from "./support/fake-pty";
import {
  type RemoteHarness,
  type RemoteHarnessOptions,
  createRemoteHarness,
  eventually,
  sandboxId,
  token,
} from "./support/remote-harness";

const nodePty = process.platform === "win32" ? undefined : await loadNodePty();
const tmuxPath = nodePty === undefined ? undefined : await detectTmux();

const decoder = new TextDecoder();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let counter = 0;

const harnesses: RemoteHarness[] = [];
const sockets: string[] = [];
const hubs: RemoteSandboxHub[] = [];
afterEach(async () => {
  await Promise.all(hubs.splice(0).map((hub) => hub.close()));
  await Promise.all(harnesses.splice(0).map((harness) => harness.cleanup()));
  // tmux servers outlive the daemon, so end each test's server explicitly.
  await Promise.all(
    sockets.splice(0).map(
      (socket) =>
        new Promise<void>((resolve) => {
          if (tmuxPath === undefined) return resolve();
          execFile(tmuxPath, ["-L", socket, "kill-server"], () => resolve());
        }),
    ),
  );
});

async function harness(options: RemoteHarnessOptions = {}) {
  const created = await createRemoteHarness(options);
  harnesses.push(created);
  return created;
}

/** Drain a handle's output into text, the way a viewer would. */
function watch(handle: TerminalHandle) {
  const state = { text: "" };
  const decode = new TextDecoder();
  const done = (async () => {
    for await (const chunk of handle.output) state.text += decode.decode(chunk, { stream: true });
  })().catch(() => undefined);
  return { state, done };
}

const shellEnv = (workdir: string) => ({ HOME: workdir, PS1: "$ ", ENV: "", BASH_ENV: "" });

for (const mode of ["shell", "tmux"] as const) {
  const available = nodePty !== undefined && (mode === "shell" || tmuxPath !== undefined);
  describe.skipIf(!available)(`terminal (${mode === "tmux" ? "tmux" : "plain shell"})`, () => {
    async function start(options: RemoteHarnessOptions = {}) {
      const socketName = `anvia-test-${process.pid}-${(counter += 1)}`;
      sockets.push(socketName);
      const terminalOptions =
        mode === "shell" ? { socketName, tmuxPath: false as const } : { socketName };
      const h = await harness({
        ...options,
        daemon: { terminal: terminalOptions, ...options.daemon },
      });
      const terminal = h.hub.terminal(sandboxId);
      const open = (
        name: string,
        extra: { cols?: number; rows?: number; readOnly?: boolean } = {},
      ) =>
        terminal.open({
          sessionName: name,
          cols: extra.cols ?? 80,
          rows: extra.rows ?? 24,
          env: shellEnv(h.workdir),
          readOnly: extra.readOnly,
        });
      return { h, terminal, open };
    }

    it("opens a session, echoes input, and returns output", async () => {
      const { open } = await start();
      const handle = await open("main");
      const view = watch(handle);
      handle.write("echo hello$((20+22))\n");
      await eventually(() => view.state.text.includes("hello42"));
      handle.close();
    });

    it("resizes the terminal", async () => {
      const { open } = await start();
      const handle = await open("sized", { cols: 80, rows: 24 });
      const view = watch(handle);
      handle.write("echo cols=$(tput cols)\n");
      await eventually(() => /cols=80\b/.test(view.state.text));
      handle.resize(120, 40);
      await sleep(200);
      handle.write("echo cols=$(tput cols) rows=$(tput lines)\n");
      await eventually(() => /cols=120 rows=40/.test(view.state.text));
      handle.close();
    });

    it("shows two viewers the same output", async () => {
      const { open, terminal } = await start();
      const first = await open("shared");
      const second = await open("shared");
      const a = watch(first);
      const b = watch(second);
      first.write("echo both$((1+1))\n");
      await eventually(() => a.state.text.includes("both2") && b.state.text.includes("both2"));
      expect(await terminal.list()).toEqual([
        expect.objectContaining({ name: "shared", attached: 2, persistent: mode === "tmux" }),
      ]);
      first.close();
      second.close();
    });

    it("replays scrollback to a viewer that attaches later", async () => {
      const { open } = await start();
      const first = await open("history");
      const a = watch(first);
      first.write("echo earlier$((2+3))\n");
      await eventually(() => a.state.text.includes("earlier5"));
      first.close();

      const second = await open("history");
      const b = watch(second);
      await eventually(() => b.state.text.includes("earlier5"));
      second.close();
    });

    it("keeps the session across a hub restart", async () => {
      const { h, open } = await start();
      const first = await open("durable");
      const a = watch(first);
      first.write("echo kept$((6*7))\n");
      await eventually(() => a.state.text.includes("kept42"));

      await h.hub.close();
      expect(await first.exit).toMatchObject({ reason: "disconnected" });
      await eventually(() => !h.daemon.connected);

      const hub2 = new RemoteSandboxHub({
        authorize: (candidate) => (candidate === token ? { sandboxId } : null),
        connectTimeoutMs: 5_000,
      });
      hubs.push(hub2);
      await hub2.listen({ host: "127.0.0.1", port: h.port });
      const again = await hub2.terminal(sandboxId).open({
        sessionName: "durable",
        cols: 80,
        rows: 24,
      });
      const b = watch(again);
      await eventually(() => b.state.text.includes("kept42"));
      again.close();
    });

    it("propagates the end of the shell", async () => {
      const { open } = await start();
      const handle = await open("short");
      watch(handle);
      handle.write("exit 3\n");
      const exit = await handle.exit;
      expect(exit.reason).toBe("exited");
      if (mode === "shell") expect(exit.exitCode).toBe(3);
    });

    it("kills a session", async () => {
      const { open, terminal } = await start();
      const handle = await open("doomed");
      watch(handle);
      await eventually(async () => (await terminal.list()).length === 1);

      await terminal.kill("doomed");
      await handle.exit;
      expect(await terminal.list()).toEqual([]);
      await expect(terminal.kill("doomed")).rejects.toMatchObject({ code: "invalid_state" });
    });

    it("ignores input from a read-only viewer", async () => {
      const { h, open } = await start();
      const writer = await open("watched");
      const w = watch(writer);
      writer.write("echo ready$((1+1))\n");
      await eventually(() => w.state.text.includes("ready2"));

      const viewer = await open("watched", { readOnly: true });
      const v = watch(viewer);
      viewer.write("touch from-viewer\n");
      viewer.resize(10, 5);
      await sleep(400);
      await expect(access(path.join(h.workdir, "from-viewer"))).rejects.toThrow();

      writer.write("echo after$((2+2))\n");
      await eventually(() => v.state.text.includes("after4"));
      writer.close();
      viewer.close();
    });

    it("rejects a bad session name and a missing directory", async () => {
      const { terminal } = await start();
      await expect(terminal.open({ sessionName: "bad name", cols: 80, rows: 24 })).rejects.toThrow(
        TypeError,
      );
      await expect(
        terminal.open({ sessionName: "ok", cols: 80, rows: 24, cwd: "nope" }),
      ).rejects.toMatchObject({ code: "invalid_path" });
    });

    it("does not delay a concurrent exec or the heartbeat while a terminal floods", async () => {
      const { h, open } = await start({ hub: { heartbeatIntervalMs: 200 } });
      const handle = await open("flood");
      const view = watch(handle);
      handle.write("yes flood\n");
      await eventually(() => view.state.text.length > 200_000, 10_000);

      const started = Date.now();
      let slowest = 0;
      while (Date.now() - started < 2_000) {
        const before = Date.now();
        const result = await h.runtime.exec({ command: "echo", args: ["alive"] });
        slowest = Math.max(slowest, Date.now() - before);
        expect(result).toMatchObject({ status: "exited", exitCode: 0 });
      }
      // The link also answered every heartbeat: three missed ones would have dropped it.
      expect(h.hub.isConnected(sandboxId)).toBe(true);
      expect(slowest).toBeLessThan(1_000);
      await h.hub.terminal(sandboxId).kill("flood");
    }, 30_000);

    it("applies flow control to a viewer that stops reading", async () => {
      const { h, open } = await start({ hub: { maxTerminalBufferBytes: 1024 * 1024 } });
      const handle = await open("stalled");
      handle.write("yes stalled | head -c 20000000\n");
      // Nobody reads handle.output, so the daemon must hold back or drop rather than let the
      // hub's buffer overflow and cut the viewer off.
      await sleep(1_500);
      let exited = false;
      void handle.exit.then(() => (exited = true));
      await sleep(200);
      expect(exited).toBe(false);
      expect((await h.runtime.exec({ command: "true" })).status).toBe("exited");

      // Once it reads again it catches up and the session is still usable.
      const view = watch(handle);
      handle.write("\necho resumed$((1+1))\n");
      await eventually(() => view.state.text.includes("resumed2"), 15_000);
      handle.close();
    }, 30_000);
  });
}

describe.skipIf(nodePty === undefined)("terminal persistence across a daemon restart", () => {
  it.skipIf(tmuxPath === undefined)("keeps tmux sessions when the daemon restarts", async () => {
    const socketName = `anvia-test-${process.pid}-${(counter += 1)}`;
    sockets.push(socketName);
    const h = await harness({ daemon: { terminal: { socketName } } });
    const handle = await h.hub.terminal(sandboxId).open({
      sessionName: "survivor",
      cols: 80,
      rows: 24,
      env: shellEnv(h.workdir),
    });
    watch(handle);
    handle.write("echo persisted$((1+1))\n");
    await sleep(300);
    await h.daemon.stop();

    const restarted = h.startDaemon({ terminal: { socketName } });
    await restarted.ready();
    const sessions = await h.hub.terminal(sandboxId).list();
    expect(sessions).toEqual([expect.objectContaining({ name: "survivor", persistent: true })]);
    const again = await h.hub.terminal(sandboxId).open({
      sessionName: "survivor",
      cols: 80,
      rows: 24,
    });
    const view = watch(again);
    await eventually(() => view.state.text.includes("persisted2"));
    again.close();
  });

  it("loses plain-shell sessions when the daemon restarts", async () => {
    const h = await harness({ daemon: { terminal: { tmuxPath: false } } });
    const handle = await h.hub.terminal(sandboxId).open({
      sessionName: "ephemeral",
      cols: 80,
      rows: 24,
      env: shellEnv(h.workdir),
    });
    watch(handle);
    await h.daemon.stop();
    expect(await handle.exit).toMatchObject({ reason: "disconnected" });

    const restarted = h.startDaemon({ terminal: { tmuxPath: false } });
    await restarted.ready();
    expect(await h.hub.terminal(sandboxId).list()).toEqual([]);
  });
});

describe("terminal capability negotiation", () => {
  async function fakeDaemon(hello: Record<string, unknown>) {
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
    await new Promise<void>((resolve, reject) => {
      socket.once("open", () => {
        socket.send(JSON.stringify({ type: "hello", protocolVersion: 1, ...hello }));
        resolve();
      });
      socket.once("error", reject);
    });
    await eventually(() => hub.isConnected(sandboxId));
    return { hub, socket, received };
  }

  it("fails with a typed error against a daemon that predates terminals", async () => {
    const { hub, socket, received } = await fakeDaemon({ daemonVersion: "old", workdir: "/w" });
    const terminal = hub.terminal(sandboxId);
    await expect(terminal.open({ sessionName: "a", cols: 80, rows: 24 })).rejects.toMatchObject({
      code: "unsupported",
    });
    await expect(terminal.list()).rejects.toMatchObject({ code: "unsupported" });
    await expect(terminal.kill("a")).rejects.toMatchObject({ code: "unsupported" });
    // Nothing the old daemon cannot parse was ever sent, so the link is intact.
    await sleep(100);
    expect(received.filter((frame) => frame.type.startsWith("pty."))).toEqual([]);
    expect(hub.isConnected(sandboxId)).toBe(true);
    socket.close();
  });

  it("fails with a typed error when the daemon has terminals switched off", async () => {
    const h = await harness({ daemon: { terminal: false } });
    await expect(
      h.hub.terminal(sandboxId).open({ sessionName: "a", cols: 80, rows: 24 }),
    ).rejects.toMatchObject({ code: "unsupported" });
    expect((await h.runtime.exec({ command: "true" })).status).toBe("exited");
  });

  it("lets a new daemon talk to a hub that predates terminals", async () => {
    const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    await new Promise((resolve) => server.once("listening", resolve));
    const { port } = server.address() as { port: number };
    const hellos: Array<Record<string, unknown>> = [];
    server.on("connection", (socket) => {
      socket.once("message", (data) => {
        hellos.push(JSON.parse(data.toString()));
        // An old hub's welcome carries no capabilities.
        socket.send(
          JSON.stringify({ type: "welcome", protocolVersion: 1, heartbeatIntervalMs: 60_000 }),
        );
      });
    });
    const h = await harness({ connect: false });
    await h.daemon.stop();
    const daemon = new SandboxDaemon({
      controlUrl: `ws://127.0.0.1:${port}`,
      token,
      workdir: h.workdir,
      stateDir: h.stateDir,
      terminal: { spawn: fakeSpawner().spawn, tmuxPath: false },
    });
    try {
      daemon.start();
      await daemon.ready();
      expect(hellos[0]?.capabilities).toEqual(["terminal"]);
      expect(daemon.connected).toBe(true);
    } finally {
      await daemon.stop();
      server.close();
    }
  });

  it("advertises tmux persistence only when tmux was found", async () => {
    const { spawn } = fakeSpawner();
    const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    await new Promise((resolve) => server.once("listening", resolve));
    const { port } = server.address() as { port: number };
    const hellos: Array<{ capabilities?: string[] }> = [];
    server.on("connection", (socket) => {
      socket.once("message", (data) => {
        hellos.push(JSON.parse(data.toString()));
        socket.send(
          JSON.stringify({ type: "welcome", protocolVersion: 1, heartbeatIntervalMs: 60_000 }),
        );
      });
    });
    const h = await harness({ connect: false });
    await h.daemon.stop();
    const make = (terminal: false | { spawn: typeof spawn; tmuxPath: false }) =>
      new SandboxDaemon({
        controlUrl: `ws://127.0.0.1:${port}`,
        token,
        workdir: h.workdir,
        stateDir: h.stateDir,
        terminal,
      });
    const none = make(false);
    const plain = make({ spawn, tmuxPath: false });
    try {
      none.start();
      await none.ready();
      plain.start();
      await plain.ready();
      expect(hellos[0]?.capabilities).toBeUndefined();
      expect(hellos[1]?.capabilities).toEqual(["terminal"]);
    } finally {
      await none.stop();
      await plain.stop();
      server.close();
    }
  });
});

describe.skipIf(nodePty === undefined)("browser terminal relay", () => {
  const origin = "https://app.example";

  async function relay(options: { daemonTerminal?: false } = {}) {
    const h = await harness({
      daemon: { terminal: options.daemonTerminal ?? { tmuxPath: false } },
      listen: { terminalPath: "/terminal" },
      hub: {
        allowedOrigins: [origin],
        authorizeTerminal: (request) => {
          const ticket = terminalTicket(request);
          if (ticket === "rw") return { sandboxId, sessionName: "web" };
          if (ticket === "ro") return { sandboxId, sessionName: "web", readOnly: true };
          return null;
        },
      },
    });
    return { h, url: `ws://127.0.0.1:${h.port}/terminal` };
  }

  /** The hub side of a browser: one socket with its messages sorted into text and output. */
  function browser(url: string, options: { protocols?: string[]; origin?: string | null } = {}) {
    const clientOptions: WebSocket.ClientOptions = {};
    if (options.origin !== null) clientOptions.origin = options.origin ?? origin;
    const socket = new WebSocket(url, options.protocols ?? ["anvia.terminal.v1"], clientOptions);
    const state = { output: "", messages: [] as Array<Record<string, unknown>> };
    socket.on("message", (data, isBinary) => {
      if (isBinary) state.output += decoder.decode(data as Buffer);
      else state.messages.push(JSON.parse(data.toString()));
    });
    const refused = new Promise<number>((resolve) => {
      socket.once("unexpected-response", (_request, response) => resolve(response.statusCode ?? 0));
      socket.once("open", () => resolve(0));
      socket.once("error", () => undefined);
    });
    const send = (message: Record<string, unknown>) => socket.send(JSON.stringify(message));
    const ready = () =>
      eventually(() => state.messages.some((message) => message.type === "ready"));
    return { socket, state, refused, send, ready };
  }

  it("refuses a missing or unknown ticket with 401", async () => {
    const { url } = await relay();
    expect(await browser(url).refused).toBe(401);
    expect(await browser(`${url}?ticket=wrong`).refused).toBe(401);
    expect(
      await browser(url, { protocols: ["anvia.terminal.v1", "anvia.ticket.wrong"] }).refused,
    ).toBe(401);
  });

  it("refuses a foreign Origin with 403 even with a valid ticket", async () => {
    const { url } = await relay();
    expect(await browser(`${url}?ticket=rw`, { origin: "https://evil.example" }).refused).toBe(403);
  });

  it("answers 404 when the hub has no terminal authorizer", async () => {
    const h = await harness({ listen: { terminalPath: "/terminal" } });
    expect(await browser(`ws://127.0.0.1:${h.port}/terminal?ticket=rw`).refused).toBe(404);
  });

  it("accepts a ticket from the query string or the subprotocol and relays I/O", async () => {
    const { url } = await relay();
    for (const viewer of [
      browser(`${url}?ticket=rw`),
      browser(url, { protocols: ["anvia.terminal.v1", "anvia.ticket.rw"] }),
    ]) {
      expect(await viewer.refused).toBe(0);
      viewer.send({ type: "open", cols: 90, rows: 30 });
      await viewer.ready();
      expect(viewer.socket.protocol).toBe("anvia.terminal.v1");
      viewer.send({ type: "input", data: "echo relayed$((3+4))\n" });
      await eventually(() => viewer.state.output.includes("relayed7"));
      viewer.socket.close();
    }
  });

  it("drops input and resize from a read-only viewer", async () => {
    const { h, url } = await relay();
    const writer = browser(`${url}?ticket=rw`);
    await writer.refused;
    writer.send({ type: "open", cols: 80, rows: 24 });
    await writer.ready();
    writer.send({ type: "input", data: "echo writer$((1+1))\n" });
    await eventually(() => writer.state.output.includes("writer2"));

    const viewer = browser(`${url}?ticket=ro`);
    await viewer.refused;
    viewer.send({ type: "open", cols: 80, rows: 24 });
    await viewer.ready();
    expect(viewer.state.messages.find((message) => message.type === "ready")).toMatchObject({
      readOnly: true,
    });
    viewer.send({ type: "input", data: "touch from-readonly\n" });
    viewer.send({ type: "resize", cols: 20, rows: 5 });
    await sleep(400);
    await expect(access(path.join(h.workdir, "from-readonly"))).rejects.toThrow();

    writer.send({ type: "input", data: "echo seen$((2+2))\n" });
    await eventually(() => viewer.state.output.includes("seen4"));
    writer.socket.close();
    viewer.socket.close();
  });

  it("detaches from the session when the browser leaves", async () => {
    const { h, url } = await relay();
    const viewer = browser(`${url}?ticket=rw`);
    await viewer.refused;
    viewer.send({ type: "open", cols: 80, rows: 24 });
    await viewer.ready();
    await eventually(async () => (await h.hub.terminal(sandboxId).list())[0]?.attached === 1);
    viewer.socket.close();
    await eventually(async () => (await h.hub.terminal(sandboxId).list())[0]?.attached === 0);
  });

  it("reports a daemon without terminals as a typed error", async () => {
    const { url } = await relay({ daemonTerminal: false });
    const viewer = browser(`${url}?ticket=rw`);
    await viewer.refused;
    viewer.send({ type: "open", cols: 80, rows: 24 });
    await eventually(() => viewer.state.messages.some((message) => message.type === "error"));
    expect(viewer.state.messages.find((message) => message.type === "error")).toMatchObject({
      code: "unsupported",
    });
  });

  it("closes a socket that sends something other than the protocol", async () => {
    const { url } = await relay();
    const viewer = browser(`${url}?ticket=rw`);
    await viewer.refused;
    const closed = new Promise<number>((resolve) => viewer.socket.once("close", resolve));
    viewer.socket.send("not json");
    expect(await closed).toBe(1002);
  });
});
