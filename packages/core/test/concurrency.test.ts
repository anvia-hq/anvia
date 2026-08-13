import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "../src/internal/concurrency";

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
} {
  let resolve: (value: T | PromiseLike<T>) => void = () => {};
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

describe("mapWithConcurrency", () => {
  it("waits for started work and stops claiming queued work after a failure", async () => {
    const failure = new Error("mapper failed");
    const failFirst = deferred<void>();
    const releaseSecond = deferred<void>();
    const secondStarted = deferred<void>();
    const started: number[] = [];
    const completed: number[] = [];

    const mapped = mapWithConcurrency([0, 1, 2], 2, async (input) => {
      started.push(input);
      if (input === 0) {
        await failFirst.promise;
        throw failure;
      }
      if (input === 1) {
        secondStarted.resolve();
        await releaseSecond.promise;
      }
      completed.push(input);
      return input;
    });
    let settled = false;
    void mapped.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );

    await secondStarted.promise;
    failFirst.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(settled).toBe(false);
    expect(started).toEqual([0, 1]);

    releaseSecond.resolve();
    await expect(mapped).rejects.toBe(failure);
    expect(started).toEqual([0, 1]);
    expect(completed).toEqual([1]);
  });
});
