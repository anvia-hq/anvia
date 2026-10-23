import { EventEmitter } from "node:events";
import WebSocket from "ws";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HubConnection } from "../src/remote/connection";

afterEach(() => {
  vi.useRealTimers();
});

/** Just enough of a WebSocket for a connection, whose state the test controls. */
function fakeSocket() {
  const socket = Object.assign(new EventEmitter(), {
    readyState: WebSocket.OPEN as number,
    send: vi.fn(),
    close: vi.fn(),
    terminate: vi.fn(),
  });
  return socket;
}

describe("HubConnection heartbeat", () => {
  it("pings an open socket on every interval", () => {
    vi.useFakeTimers();
    const socket = fakeSocket();
    const connection = new HubConnection(socket as unknown as WebSocket, "/w", 1_000);
    vi.advanceTimersByTime(2_000);
    expect(socket.send.mock.calls.map(([data]) => JSON.parse(String(data)).type)).toEqual([
      "ping",
      "ping",
    ]);
    connection.close(1000, "done");
  });

  it("does not throw when a tick lands while the socket is closing", () => {
    // Between close() and the "close" event the socket is CLOSING and the timer is still running.
    // A throw from the timer callback is an uncaught exception, which ends the hub's process.
    vi.useFakeTimers();
    const socket = fakeSocket();
    const connection = new HubConnection(socket as unknown as WebSocket, "/w", 1_000);
    socket.readyState = WebSocket.CLOSING;
    expect(() => vi.advanceTimersByTime(3_000)).not.toThrow();
    expect(socket.send).not.toHaveBeenCalled();
    connection.close(1000, "done");
  });
});
