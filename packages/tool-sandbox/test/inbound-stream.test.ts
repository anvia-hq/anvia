import { describe, expect, it, vi } from "vitest";
import { InboundStream } from "../src/remote/inbound-stream";

const bytes = (length: number) => new Uint8Array(length);

function stream(maxBufferBytes = 100, ackStepBytes?: number) {
  const acks: number[] = [];
  const onOverflow = vi.fn();
  const onEnd = vi.fn();
  const inbound = new InboundStream<{ reason: string }>({
    maxBufferBytes,
    ackStepBytes,
    label: "Test",
    overflowEnd: { reason: "error" },
    onConsumed: (total) => acks.push(total),
    onOverflow,
    onEnd,
  });
  return { inbound, acks, onOverflow, onEnd };
}

describe("InboundStream", () => {
  it("acknowledges bytes only once the reader asks for more", async () => {
    const { inbound, acks } = stream();
    inbound.push(bytes(10));
    inbound.push(bytes(20));
    const reader = inbound.chunks[Symbol.asyncIterator]();

    await reader.next();
    expect(acks).toEqual([]); // The reader still holds the first chunk.
    await reader.next();
    expect(acks).toEqual([10]);
    inbound.end({ reason: "done" });
    await reader.next();
    expect(acks).toEqual([10]); // Nothing is acknowledged once the stream has ended.
  });

  it("acknowledges in steps, and always once the reader has caught up", async () => {
    const { inbound, acks } = stream(100, 25);
    for (let index = 0; index < 4; index += 1) inbound.push(bytes(10));
    const reader = inbound.chunks[Symbol.asyncIterator]();

    for (let index = 0; index < 4; index += 1) await reader.next();
    // After ten and twenty bytes the ack waits: under a step, and more is queued. After thirty it
    // goes out. The fourth chunk is still being handled.
    expect(acks).toEqual([30]);

    // The reader is out of chunks and asks for more: everything it handled is acknowledged.
    const waiting = reader.next();
    expect(acks).toEqual([30, 40]);
    inbound.end({ reason: "done" });
    await waiting;
  });

  it("acknowledges a small tail even though it is under a step, so a stopped sender restarts", async () => {
    const { inbound, acks } = stream(100, 1_000);
    const reader = inbound.chunks[Symbol.asyncIterator]();
    inbound.push(bytes(5));
    await reader.next();
    const waiting = reader.next(); // The reader is out of chunks and asks for more.
    expect(acks).toEqual([5]);
    inbound.end({ reason: "done" });
    await waiting;
  });

  it("delivers what is queued before reporting the end", async () => {
    const { inbound } = stream();
    inbound.push(bytes(3));
    inbound.end({ reason: "done" });
    const seen: number[] = [];
    for await (const chunk of inbound.chunks) seen.push(chunk.byteLength);
    expect(seen).toEqual([3]);
    expect(await inbound.ended).toEqual({ reason: "done" });
  });

  it("cuts the stream off when the sender ignores flow control", async () => {
    const { inbound, onOverflow } = stream(50);
    inbound.push(bytes(30));
    inbound.push(bytes(30));
    expect(onOverflow).toHaveBeenCalledTimes(1);
    expect(await inbound.ended).toEqual({ reason: "error" });

    // The reader still drains what was queued, then sees why it ended.
    const reader = inbound.chunks[Symbol.asyncIterator]();
    expect((await reader.next()).value?.byteLength).toBe(30);
    await expect(reader.next()).rejects.toMatchObject({
      message: "Test consumer is too slow.",
      code: "protocol",
    });
  });

  it("tells its owner once when it ends, whichever way it ends", async () => {
    const closed = stream();
    closed.inbound.end({ reason: "done" });
    closed.inbound.end({ reason: "again" });
    expect(closed.onEnd.mock.calls).toEqual([[{ reason: "done" }]]);

    // An overflow ends the stream too, so the owner hears about it through the same hook.
    const overflowed = stream(10);
    overflowed.inbound.push(bytes(20));
    expect(overflowed.onOverflow).toHaveBeenCalledTimes(1);
    expect(overflowed.onEnd.mock.calls).toEqual([[{ reason: "error" }]]);
  });

  it("ignores data after the end and keeps the first end", async () => {
    const { inbound } = stream();
    inbound.end({ reason: "first" });
    inbound.end({ reason: "second" });
    inbound.push(bytes(5));
    expect(await inbound.ended).toEqual({ reason: "first" });
    const seen: number[] = [];
    for await (const chunk of inbound.chunks) seen.push(chunk.byteLength);
    expect(seen).toEqual([]);
  });
});
