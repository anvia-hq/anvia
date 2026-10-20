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
      maxClosedStreams: 0,
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

  it("does not leave subscribers of an evicted stream dangling", async () => {
    const store = createMemoryResumableStreamStore<string>({ closedStreamTtlMs: 1_000 });
    await store.open({ streamId: "s1" });
    await store.close({ streamId: "s1", status: "completed" });

    // A live subscriber on a running stream keeps receiving events normally.
    await store.open({ streamId: "live" });
    const seen: string[] = [];
    const iterator = store.subscribe({ streamId: "live" })[Symbol.asyncIterator]();
    const pending = (async () => {
      const next = await iterator.next();
      if (!next.done && next.value) {
        seen.push(next.value.event as string);
      }
    })();
    await store.append({ streamId: "live", event: "hello" });
    await pending;
    expect(seen).toEqual(["hello"]);
    await iterator.return?.();

    // Evict the closed stream; subscribing afterwards resolves immediately
    // with no records instead of hanging on a stale subscriber queue.
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
    expect(await store.status({ streamId: "live" })).toMatchObject({ status: "running" });
  });
});
