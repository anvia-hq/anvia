import { afterEach, describe, expect, it, vi } from "vitest";
import type { DurableTransaction } from "../src/types.js";
import { durableLimits, limitedTransaction } from "../src/limits.js";
import { DurableLimitError } from "../src/errors.js";

/**
 * A fake transaction. The limit checks run before the writes, so the writes can be no-ops; only
 * the serialization made by the checks is under test.
 */
function fakeTransaction(): DurableTransaction {
  const none = () => undefined;
  return {
    getRun: none,
    getTask: none,
    getOperation: none,
    pendingCounts: () => ({ runs: 0, tasks: 0 }),
    operationCount: () => 0,
    putRun: none,
    putTask: none,
    putOperation: none,
    appendEvent: none,
    putBlob: () => "",
    getBlob: () => null,
  } as unknown as DurableTransaction;
}

/** How many serialized results of this check contain the marker text. */
function serializationsOf(spy: { mock: { results: { value: unknown }[] } }, marker: string) {
  return spy.mock.results.filter(
    (result) => typeof result.value === "string" && result.value.includes(marker),
  ).length;
}

const marker = "payload-marker ";
const big = marker.repeat(20_000); // about 320 KB: under the default 1 MiB budget
const huge = marker.repeat(200_000); // about 3.2 MB: over the default budget

afterEach(() => {
  vi.restoreAllMocks();
});

describe("limit checks serialize each payload once", () => {
  it("serializes a completed task output once for the size and change checks", async () => {
    const spy = vi.spyOn(JSON, "stringify");
    const limited = limitedTransaction(fakeTransaction(), durableLimits());
    await limited.putTask({
      id: "task",
      status: "completed",
      outcome: { status: "completed", output: big },
    } as never);
    expect(serializationsOf(spy, marker)).toBe(1);
  });

  it("serializes an operation input once", async () => {
    const spy = vi.spyOn(JSON, "stringify");
    const limited = limitedTransaction(fakeTransaction(), durableLimits());
    await limited.putOperation("run", { key: "op", input: { text: big } } as never);
    expect(serializationsOf(spy, marker)).toBe(1);
  });

  it("still rejects an oversized payload with the field and limit", async () => {
    const limited = limitedTransaction(fakeTransaction(), durableLimits());
    const error = await (async () => {
      try {
        await limited.putOperation("run", { key: "op", input: { text: huge } } as never);
      } catch (caught) {
        return caught;
      }
      return undefined;
    })();
    expect(error).toBeInstanceOf(DurableLimitError);
    expect((error as DurableLimitError).field).toBe("operation.input");
  });
});

describe("status events", () => {
  it("are not serialized or payload-checked", () => {
    const spy = vi.spyOn(JSON, "stringify");
    const limited = limitedTransaction(fakeTransaction(), durableLimits({ maxPayloadBytes: 10 }));
    expect(async () =>
      limited.appendEvent("run", "status", { status: "failed", error: huge }),
    ).not.toThrow();
    expect(spy).not.toHaveBeenCalled();
  });
});
