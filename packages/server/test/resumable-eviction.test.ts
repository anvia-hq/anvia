import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryResumableStreamStore } from "../src";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("memory resumable stream store eviction", () => {
  it("removes a closed stream after the TTL", async () => {
    const store = createMemoryResumableStreamStore<string>({ closedStreamTtlMs: 60_000 });
    await store.open({ streamId: "s1" });
    await store.append({ streamId: "s1", event: "a" });
    await store.close({ streamId: "s1", status: "completed" });

    expect(await store.status({ streamId: "s1" })).toMatchObject({ status: "completed" });

    await vi.advanceTimersByTimeAsync(60_000);
    expect(await store.status({ streamId: "s1" })).toEqual({ status: "missing", lastEventId: 0 });
  });

  it("evicts the oldest closed stream when the cap is exceeded", async () => {
    const store = createMemoryResumableStreamStore<string>({ maxClosedStreams: 2 });
    for (const id of ["a", "b", "c"]) {
      await store.open({ streamId: id });
      await store.close({ streamId: id, status: "completed" });
      await vi.advanceTimersByTimeAsync(1);
    }

    expect(await store.status({ streamId: "a" })).toEqual({
      status: "missing",
      lastEventId: 0,
    });
    expect(await store.status({ streamId: "b" })).toMatchObject({ status: "completed" });
    expect(await store.status({ streamId: "c" })).toMatchObject({ status: "completed" });
  });

  it("never evicts a running stream", async () => {
    const store = createMemoryResumableStreamStore<string>({
      closedStreamTtlMs: 1,
      maxClosedStreams: 1,
    });
    await store.open({ streamId: "open" });
    await store.open({ streamId: "closed" });
    await store.close({ streamId: "closed", status: "completed" });

    await vi.advanceTimersByTimeAsync(60_000);

    expect(await store.status({ streamId: "open" })).toMatchObject({ status: "running" });
    await store.append({ streamId: "open", event: "still-here" });
    expect(await store.status({ streamId: "open" })).toMatchObject({
      status: "running",
      lastEventId: 1,
    });
  });

  it("ends a running subscriber when its stream closes", async () => {
    const store = createMemoryResumableStreamStore<string>({ closedStreamTtlMs: 1_000 });
    await store.open({ streamId: "s1" });
    const iterator = store.subscribe({ streamId: "s1" })[Symbol.asyncIterator]();

    await store.append({ streamId: "s1", event: "hello" });
    expect(await iterator.next()).toMatchObject({ done: false, value: { event: "hello" } });

    // Closing ends the subscriber: queued records are drained first, then
    // the iterator completes.
    await store.close({ streamId: "s1", status: "completed" });
    expect(await iterator.next()).toEqual({ value: undefined, done: true });

    // An evicted stream reports missing: subscribing after the TTL yields
    // no records and the final status is gone.
    await vi.advanceTimersByTimeAsync(1_000);
    const records: unknown[] = [];
    for await (const record of store.subscribe({ streamId: "s1" })) {
      records.push(record);
    }
    expect(records).toEqual([]);
    expect(await store.status({ streamId: "s1" })).toEqual({
      status: "missing",
      lastEventId: 0,
    });
  });

  it("keeps a just-closed stream readable for resumers", async () => {
    for (const options of [{ closedStreamTtlMs: 0 }, { maxClosedStreams: 0 }]) {
      const store = createMemoryResumableStreamStore<string>(options);
      await store.open({ streamId: "s1" });
      await store.append({ streamId: "s1", event: "a" });
      await store.close({ streamId: "s1", status: "completed" });

      // Zero TTL/cap are clamped so close() does not evict immediately: the
      // final state must still be visible to resumers.
      expect(await store.status({ streamId: "s1" })).toEqual({
        status: "completed",
        lastEventId: 1,
      });
      const records: unknown[] = [];
      for await (const record of store.subscribe({ streamId: "s1" })) {
        records.push(record);
      }
      expect(records).toHaveLength(1);
    }
  });
});
