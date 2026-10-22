import { afterEach, describe, expect, it } from "vitest";
import WebSocket, { WebSocketServer } from "ws";
import type { SandboxTerminal, TerminalHandle, TerminalOpenOptions } from "../src/remote/index";
import { type TerminalAuthorization, relayTerminal } from "../src/remote/terminal-relay";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const servers: WebSocketServer[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

/** A terminal that records what the relay forwards, so the relay is tested without the daemon. */
function stubTerminal() {
  const calls = {
    opened: [] as TerminalOpenOptions[],
    writes: [] as string[],
    resizes: [] as Array<[number, number]>,
    closed: 0,
  };
  let finish!: () => void;
  const ended = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const handle: TerminalHandle = {
    sessionName: "s",
    write: (data) => void calls.writes.push(typeof data === "string" ? data : "<bytes>"),
    resize: (cols, rows) => void calls.resizes.push([cols, rows]),
    close: () => {
      calls.closed += 1;
      finish();
    },
    output: (async function* () {
      yield new TextEncoder().encode("hello");
      await ended;
    })(),
    exit: ended.then(() => ({ reason: "closed" as const })),
  };
  const terminal: SandboxTerminal = {
    open: async (options) => {
      calls.opened.push(options);
      return handle;
    },
    list: async () => [],
    kill: async () => undefined,
  };
  return { terminal, calls };
}

async function connect(authorization: TerminalAuthorization) {
  const { terminal, calls } = stubTerminal();
  const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  servers.push(server);
  server.on("connection", (ws) => relayTerminal(ws, { terminal, authorization }));
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address() as { port: number };
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  const messages: Array<Record<string, unknown>> = [];
  socket.on("message", (data, isBinary) => {
    if (!isBinary) messages.push(JSON.parse(data.toString()));
  });
  await new Promise((resolve) => socket.once("open", resolve));
  const send = (message: Record<string, unknown>) => socket.send(JSON.stringify(message));
  const ready = async () => {
    send({ type: "open", cols: 100, rows: 30 });
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (messages.some((message) => message.type === "ready")) return;
      await sleep(10);
    }
    throw new Error("terminal never became ready");
  };
  return { socket, send, ready, calls, messages };
}

describe("relayTerminal", () => {
  it("opens the granted session at the size the browser asked for", async () => {
    const viewer = await connect({ sandboxId: "sb", sessionName: "s", cwd: "work" });
    await viewer.ready();
    expect(viewer.calls.opened).toEqual([
      expect.objectContaining({
        sessionName: "s",
        cols: 100,
        rows: 30,
        cwd: "work",
        readOnly: false,
      }),
    ]);
    viewer.socket.close();
  });

  it("forwards input and resize from a read-write viewer", async () => {
    const viewer = await connect({ sandboxId: "sb", sessionName: "s" });
    await viewer.ready();
    viewer.send({ type: "input", data: "ls\n" });
    viewer.send({ type: "resize", cols: 120, rows: 40 });
    await sleep(100);
    expect(viewer.calls.writes).toEqual(["ls\n"]);
    expect(viewer.calls.resizes).toEqual([[120, 40]]);
    viewer.socket.close();
  });

  it("drops input and resize in the relay itself for a read-only viewer", async () => {
    const viewer = await connect({ sandboxId: "sb", sessionName: "s", readOnly: true });
    await viewer.ready();
    expect(viewer.calls.opened[0]?.readOnly).toBe(true);
    viewer.send({ type: "input", data: "rm -rf /\n" });
    viewer.send({ type: "resize", cols: 5, rows: 5 });
    await sleep(100);
    expect(viewer.calls.writes).toEqual([]);
    expect(viewer.calls.resizes).toEqual([]);
    viewer.socket.close();
  });

  it("ignores input that arrives before the terminal is open", async () => {
    const viewer = await connect({ sandboxId: "sb", sessionName: "s" });
    viewer.send({ type: "input", data: "too early\n" });
    await viewer.ready();
    await sleep(50);
    expect(viewer.calls.writes).toEqual([]);
    viewer.socket.close();
  });

  it("detaches the terminal when the browser disconnects", async () => {
    const viewer = await connect({ sandboxId: "sb", sessionName: "s" });
    await viewer.ready();
    viewer.socket.close();
    await sleep(100);
    expect(viewer.calls.closed).toBe(1);
  });
});
