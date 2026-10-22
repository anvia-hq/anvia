import { describe, expect, it, vi } from "vitest";
import { InboundStream } from "../src/remote/inbound-stream";

const bytes = (length: number) => new Uint8Array(length);

function stream(maxBufferBytes = 100) {
  const acks: number[] = [];
  const onOverflow = vi.fn();
  const inbound = new InboundStream<{ reason: string }>({
    maxBufferBytes,
    label: "Test",
    overflowEnd: { reason: "error" },
    onConsumed: (total) => acks.push(total),
    onOverflow,
  });
  return { inbound, acks, onOverflow };
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
