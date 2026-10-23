import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { VncChannel } from "../src/sandbox-desktop/vnc-channel";
import { FakeSocket } from "./sandbox-terminal-support";

beforeEach(() => {
  vi.stubGlobal("WebSocket", FakeSocket);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const link = () => ({ send: vi.fn(), close: vi.fn() });
const frame = (...bytes: number[]) => Uint8Array.from(bytes).buffer;

describe("VncChannel", () => {
  it("holds frames that arrive before the client attaches, then delivers them in order", () => {
    const channel = new VncChannel(link());
    channel.receive(frame(1));
    channel.receive(frame(2));
    const seen: number[] = [];
    channel.onmessage = (event) => seen.push(new Uint8Array(event.data)[0] ?? -1);
    expect(seen).toEqual([1, 2]);
    channel.receive(frame(3));
    expect(seen).toEqual([1, 2, 3]);
  });

  it("is open until either side closes it, and reports the relay's close", () => {
    const wrapped = link();
    const channel = new VncChannel(wrapped, "anvia.desktop.v1");
    expect(channel).toMatchObject({ readyState: 1, protocol: "anvia.desktop.v1" });
    const onclose = vi.fn();
    channel.onclose = onclose;
    channel.send(new Uint8Array([9]));
    expect(wrapped.send).toHaveBeenCalledTimes(1);

    channel.closed({ code: 1011, reason: "port: refused" });
    expect(channel.readyState).toBe(3);
    expect(onclose).toHaveBeenCalledWith({ code: 1011, reason: "port: refused" });
    channel.send(new Uint8Array([9]));
    expect(wrapped.send).toHaveBeenCalledTimes(1); // Nothing is sent on a closed channel.
    channel.close();
    expect(wrapped.close).not.toHaveBeenCalled(); // Already closed by the relay.
  });

  it("closes the link when the client disconnects", () => {
    const wrapped = link();
    const channel = new VncChannel(wrapped);
    channel.close();
    channel.close();
    expect(wrapped.close).toHaveBeenCalledTimes(1);
    expect(channel.readyState).toBe(3);
  });

  describe("with noVNC's own socket layer", () => {
    // noVNC's Websock is what actually validates a channel and reads from it. It needs no canvas, so
    // it can run here, unlike the full client, which is mocked in the component tests.
    async function websock() {
      const path = new URL("../node_modules/@novnc/novnc/core/websock.js", import.meta.url)
        .pathname;
      const module = (await import(/* @vite-ignore */ path)) as {
        default: new () => {
          attach(channel: unknown): void;
          on(event: string, handler: (event?: unknown) => void): void;
          readonly readyState: string;
          readonly rQlen: number;
          rQshiftBytes(length: number): Uint8Array;
          sQpushBytes(bytes: Uint8Array): void;
          flush(): void;
        };
      };
      return new module.default();
    }

    it("accepts the channel, receives what was queued before it attached, and sends through it", async () => {
      const sock = await websock();
      const wrapped = link();
      const channel = new VncChannel(wrapped);
      channel.receive(new TextEncoder().encode("RFB 003.008\n").buffer as ArrayBuffer);

      expect(() => sock.attach(channel)).not.toThrow();
      expect(sock.readyState).toBe("open");
      expect(new TextDecoder().decode(sock.rQshiftBytes(12))).toBe("RFB 003.008\n");

      channel.receive(frame(7, 8));
      expect(Array.from(sock.rQshiftBytes(2))).toEqual([7, 8]);

      sock.sQpushBytes(Uint8Array.from([5, 1, 0, 10, 0, 20]));
      sock.flush();
      expect(wrapped.send).toHaveBeenCalledTimes(1);
      expect(Array.from(new Uint8Array(wrapped.send.mock.calls[0]?.[0] as ArrayBuffer))).toEqual([
        5, 1, 0, 10, 0, 20,
      ]);
    });

    it("sees the relay closing the channel", async () => {
      const sock = await websock();
      const channel = new VncChannel(link());
      sock.attach(channel);
      const closed = vi.fn();
      sock.on("close", closed);
      channel.closed({ code: 1006, reason: "" });
      expect(closed).toHaveBeenCalledTimes(1);
      expect(sock.readyState).toBe("closed");
    });
  });
});
