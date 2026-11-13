import { describe, expect, it } from "vitest";
import { SqliteDurableStore } from "../src/sqlite.js";
import type { DurableTransaction } from "../src/types.js";

describe("SQLite transaction contract", () => {
  it("rolls back events together and invalidates escaped transaction handles", async () => {
    const store = new SqliteDurableStore(":memory:");
    await store.acquire();
    try {
      let escaped!: DurableTransaction;
      await expect(async () =>
        store.transaction(async (tx) => {
          escaped = tx;
          await tx.appendEvent("run", "submitted", { prompt: "not committed" });
          throw new Error("rollback");
        }),
      ).rejects.toThrow("rollback");
      expect(await store.events("run", 0, 100)).toEqual([]);
      await expect(async () => escaped.appendEvent("run", "status", {})).rejects.toThrow(
        "finished",
      );
      await store.transaction(async (tx) =>
        tx.appendEvent("run", "submitted", { prompt: "committed" }),
      );
      expect(await store.events("run", 0, 100)).toHaveLength(1);
    } finally {
      await store.close();
    }
  });

  it("rejects nested transactions, keeps awaited work atomic, and serializes concurrent ones", async () => {
    const store = new SqliteDurableStore(":memory:");
    await store.acquire();
    try {
      await expect(
        store.transaction(async (tx) => {
          await tx.appendEvent("run", "submitted", {});
          await Promise.resolve();
          await store.transaction(async () => undefined);
        }),
      ).rejects.toThrow("Nested");
      expect(await store.events("run", 0, 100)).toEqual([]);
      await Promise.all(
        [1, 2, 3].map((n) =>
          store.transaction(async (tx) => {
            await tx.appendEvent("run", "status", { n });
            await Promise.resolve();
            await tx.appendEvent("run", "status", { n });
          }),
        ),
      );
      const order = (await store.events("run", 0, 100)).map(
        (event) => (event.data as { n: number }).n,
      );
      expect(order).toEqual([1, 1, 2, 2, 3, 3]);
    } finally {
      await store.close();
    }
  });

  it("rejects invalid event cursors and non-JSON state", async () => {
    const store = new SqliteDurableStore(":memory:");
    await store.acquire();
    try {
      await expect(async () => store.events("run", -1, 10)).rejects.toThrow("cursor");
      await expect(async () => store.events("run", 0, 1001)).rejects.toThrow("page size");
      await expect(async () =>
        store.transaction(async (tx) => tx.appendEvent("run", "submitted", { value: Number.NaN })),
      ).rejects.toThrow("JSON");
      expect(await store.events("run", 0, 100)).toEqual([]);
    } finally {
      await store.close();
    }
  });
});
