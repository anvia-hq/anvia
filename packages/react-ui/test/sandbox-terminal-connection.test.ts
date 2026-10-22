import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  TerminalConnection,
  type SandboxTerminalStatus,
  type TerminalConnectionOptions,
} from "../src/sandbox-terminal/connection";
import { FakeSocket, resetSockets } from "./sandbox-terminal-support";

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", FakeSocket);
  resetSockets();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function setup(overrides: Partial<TerminalConnectionOptions> = {}) {
  const statuses: SandboxTerminalStatus[] = [];
  const output: string[] = [];
  const opens: boolean[] = [];
  const connection = new TerminalConnection({
    url: "wss://hub.example/terminal",
    size: () => ({ cols: 100, rows: 30 }),
    onOutput: (bytes) => output.push(new TextDecoder().decode(bytes)),
    onOpen: (reconnected) => opens.push(reconnected),
    onStatus: (status) => statuses.push(status),
    ...overrides,
  });
  return { connection, statuses, output, opens, states: () => statuses.map((s) => s.state) };
}

/** Run pending promise callbacks, since opening a socket awaits the ticket. */
const flush = () => vi.advanceTimersByTimeAsync(0);

async function connectAndReady(ctx: ReturnType<typeof setup>) {
  ctx.connection.start();
  await flush();
  FakeSocket.last.serverOpen();
  FakeSocket.last.serverMessage({ type: "ready" });
}

describe("TerminalConnection", () => {
  it("opens with the terminal's size and delivers output once ready", async () => {
    const ctx = setup();
    ctx.connection.start();
    await flush();
    const socket = FakeSocket.last;
    expect(socket.protocols).toEqual(["anvia.terminal.v1"]);
    expect(socket.binaryType).toBe("arraybuffer");

    socket.serverOpen();
    expect(socket.sent).toEqual([{ type: "open", cols: 100, rows: 30 }]);
    socket.serverOutput(new TextEncoder().encode("too early"));
    expect(ctx.output).toEqual([]);

    socket.serverMessage({ type: "ready" });
    socket.serverOutput(new TextEncoder().encode("hello"));
    expect(ctx.output).toEqual(["hello"]);
    expect(ctx.opens).toEqual([false]);
    expect(ctx.states()).toEqual(["connecting", "open"]);
  });

  it("sends input and resize only while open", async () => {
    const ctx = setup();
    ctx.connection.sendInput("lost");
    await connectAndReady(ctx);
    ctx.connection.sendInput("ls\n");
    ctx.connection.sendResize(120, 40);
    expect(FakeSocket.last.sent.slice(1)).toEqual([
      { type: "input", data: "ls\n" },
      { type: "resize", cols: 120, rows: 40 },
    ]);
  });

  it("turns http URLs into ws and passes the session name along", async () => {
    const ctx = setup({ url: "https://hub.example/terminal?x=1", sessionName: "dev" });
    ctx.connection.start();
    await flush();
    expect(FakeSocket.last.url).toBe("wss://hub.example/terminal?x=1&session=dev");
  });

  it("offers the ticket as a subprotocol and asks for a fresh one every attempt", async () => {
    let issued = 0;
    const ctx = setup({ getTicket: async () => `ticket${(issued += 1)}` });
    await connectAndReady(ctx);
    expect(FakeSocket.last.protocols).toEqual(["anvia.terminal.v1", "anvia.ticket.ticket1"]);

    FakeSocket.last.serverClose();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(FakeSocket.instances).toHaveLength(2);
    expect(FakeSocket.last.protocols).toEqual(["anvia.terminal.v1", "anvia.ticket.ticket2"]);
  });

  it("refuses a ticket that cannot travel as a subprotocol", async () => {
    const ctx = setup({ getTicket: () => "has space" });
    ctx.connection.start();
    await flush();
    expect(FakeSocket.instances).toHaveLength(0);
    expect(ctx.statuses.at(-1)).toMatchObject({ state: "failed" });
  });

  it("reconnects with backoff after the link drops and flags the reattach", async () => {
    const ctx = setup({ reconnect: { initialDelayMs: 100, maxDelayMs: 1_000 } });
    await connectAndReady(ctx);
    FakeSocket.last.serverClose();
    expect(ctx.statuses.at(-1)).toMatchObject({ state: "reconnecting", attempt: 1 });

    await vi.advanceTimersByTimeAsync(200);
    expect(FakeSocket.instances).toHaveLength(2);
    FakeSocket.last.serverOpen();
    FakeSocket.last.serverMessage({ type: "ready" });
    expect(ctx.opens).toEqual([false, true]);
    expect(ctx.states().at(-1)).toBe("open");
  });

  it("backs off exponentially and gives up after maxAttempts", async () => {
    const ctx = setup({ reconnect: { initialDelayMs: 100, maxDelayMs: 10_000, maxAttempts: 3 } });
    ctx.connection.start();
    await flush();
    const delays: number[] = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      FakeSocket.last.serverClose();
      const status = ctx.statuses.at(-1);
      delays.push(status?.retryInMs ?? 0);
      await vi.advanceTimersByTimeAsync(status?.retryInMs ?? 0);
    }
    expect(delays[1]).toBeGreaterThan((delays[0] ?? 0) * 1.3);
    expect(delays[2]).toBeGreaterThan((delays[1] ?? 0) * 1.3);

    FakeSocket.last.serverClose();
    expect(ctx.statuses.at(-1)).toMatchObject({ state: "failed" });
    expect(FakeSocket.instances).toHaveLength(4);
  });

  it("does not reconnect once the session ended", async () => {
    const ctx = setup();
    await connectAndReady(ctx);
    FakeSocket.last.serverMessage({ type: "exit", reason: "exited", exitCode: 3 });
    FakeSocket.last.serverClose();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeSocket.instances).toHaveLength(1);
    expect(ctx.statuses.at(-1)).toEqual({ state: "ended", message: "exited", exitCode: 3 });
  });

  it("stops on a fatal error but retries one that may clear up", async () => {
    const fatal = setup();
    fatal.connection.start();
    await flush();
    FakeSocket.last.serverOpen();
    FakeSocket.last.serverMessage({ type: "error", code: "unsupported", message: "No terminals." });
    FakeSocket.last.serverClose();
    expect(fatal.statuses.at(-1)).toEqual({ state: "failed", message: "No terminals." });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeSocket.instances).toHaveLength(1);

    resetSockets();
    const transient = setup();
    transient.connection.start();
    await flush();
    FakeSocket.last.serverMessage({ type: "error", code: "sandbox_unavailable", message: "Down." });
    FakeSocket.last.serverClose();
    expect(transient.statuses.at(-1)?.state).toBe("reconnecting");
  });

  it("forgets a fatal error once it is retried away", async () => {
    const ctx = setup({ reconnect: { initialDelayMs: 100 } });
    ctx.connection.start();
    await flush();
    FakeSocket.last.serverOpen();
    FakeSocket.last.serverMessage({ type: "error", code: "invalid_state", message: "Too many." });
    FakeSocket.last.serverClose();
    expect(ctx.statuses.at(-1)?.state).toBe("failed");

    ctx.connection.retry();
    await flush();
    FakeSocket.last.serverOpen();
    FakeSocket.last.serverMessage({ type: "ready" });
    expect(ctx.statuses.at(-1)?.state).toBe("open");

    // A later drop is an ordinary drop, not the old error again.
    FakeSocket.last.serverClose();
    expect(ctx.statuses.at(-1)?.state).toBe("reconnecting");
  });

  it("backs off when fetching a ticket fails, then connects once it works", async () => {
    let attempts = 0;
    const ctx = setup({
      getTicket: async () => {
        attempts += 1;
        if (attempts < 3) throw new Error("ticket endpoint is down");
        return "good";
      },
      reconnect: { initialDelayMs: 100, maxDelayMs: 1_000 },
    });
    ctx.connection.start();
    await flush();
    expect(FakeSocket.instances).toHaveLength(0);
    expect(ctx.statuses.at(-1)).toMatchObject({ state: "reconnecting", attempt: 1 });

    await vi.advanceTimersByTimeAsync(ctx.statuses.at(-1)?.retryInMs ?? 0);
    expect(ctx.statuses.at(-1)).toMatchObject({ state: "reconnecting", attempt: 2 });
    expect(FakeSocket.instances).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(ctx.statuses.at(-1)?.retryInMs ?? 0);
    expect(FakeSocket.instances).toHaveLength(1);
    expect(FakeSocket.last.protocols).toEqual(["anvia.terminal.v1", "anvia.ticket.good"]);
  });

  it("gives up on a ticket that keeps failing, and says why", async () => {
    const ctx = setup({
      getTicket: async () => {
        throw new Error("ticket endpoint is down");
      },
      reconnect: { initialDelayMs: 10, maxDelayMs: 10, maxAttempts: 2 },
    });
    ctx.connection.start();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(FakeSocket.instances).toHaveLength(0);
    expect(ctx.statuses.at(-1)).toEqual({
      state: "failed",
      message: "Could not get a terminal ticket: ticket endpoint is down",
    });
  });

  it("ignores retry() while an attempt is already under way", async () => {
    const ctx = setup();
    ctx.connection.start();
    await flush();
    ctx.connection.retry();
    await flush();
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it("retries on demand after giving up", async () => {
    const ctx = setup({ reconnect: { maxAttempts: 0 } });
    ctx.connection.start();
    await flush();
    FakeSocket.last.serverClose();
    expect(ctx.statuses.at(-1)?.state).toBe("failed");

    ctx.connection.retry();
    await flush();
    expect(FakeSocket.instances).toHaveLength(2);
    expect(ctx.statuses.at(-1)?.state).toBe("connecting");
  });

  it("closes the socket and stops reconnecting when disposed", async () => {
    const ctx = setup();
    await connectAndReady(ctx);
    const socket = FakeSocket.last;
    ctx.connection.dispose();
    expect(socket.closedWith).toBe(1000);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeSocket.instances).toHaveLength(1);
    expect(ctx.states().at(-1)).toBe("open");
  });
});
