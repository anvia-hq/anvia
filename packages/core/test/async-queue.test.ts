import { describe, expect, it } from "vitest";
import { createAsyncQueue } from "../src/internal/async-queue";

describe("createAsyncQueue", () => {
  it("yields values enqueued before reads and then completes when closed", async () => {
    const queue = createAsyncQueue<number>();
    queue.enqueue(1);
    queue.enqueue(2);
    queue.close();

    await expect(collect(queue)).resolves.toEqual([1, 2]);
  });

  it("resolves pending reads when values arrive", async () => {
    const queue = createAsyncQueue<string>();
    const iterator = queue[Symbol.asyncIterator]();
    const next = iterator.next();

    queue.enqueue("ready");

    await expect(next).resolves.toEqual({ value: "ready", done: false });
  });

  it("resolves pending reads as done when closed", async () => {
    const queue = createAsyncQueue<string>();
    const iterator = queue[Symbol.asyncIterator]();
    const next = iterator.next();

    queue.close();

    await expect(next).resolves.toEqual({ value: undefined, done: true });
    await expect(iterator.next()).resolves.toEqual({ value: undefined, done: true });
  });

  it("rejects pending and future reads when thrown", async () => {
    const queue = createAsyncQueue<string>();
    const iterator = queue[Symbol.asyncIterator]();
    const error = new Error("queue failed");
    const next = iterator.next();

    queue.throw(error);

    await expect(next).rejects.toThrow(error);
    await expect(iterator.next()).rejects.toThrow(error);
  });

  it("ignores values enqueued after close", async () => {
    const queue = createAsyncQueue<number>();

    queue.close();
    queue.enqueue(1);

    await expect(collect(queue)).resolves.toEqual([]);
  });

  it("drains buffered values before surfacing a queued error", async () => {
    const queue = createAsyncQueue<number>();
    const iterator = queue[Symbol.asyncIterator]();
    const error = new Error("late failure");

    queue.enqueue(1);
    queue.throw(error);

    await expect(iterator.next()).resolves.toEqual({ value: 1, done: false });
    await expect(iterator.next()).rejects.toThrow(error);
  });
});

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of iterable) {
    values.push(value);
  }
  return values;
}
