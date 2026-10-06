import { describe, expect, it } from "vitest";
import { SqliteDurableStore } from "../src/sqlite.js";
import type { DurableTransaction } from "../src/types.js";

describe("SQLite transaction contract", () => {
  it("rolls back events together and invalidates escaped transaction handles", () => {
    const store = new SqliteDurableStore(":memory:");
    store.acquire();
    try {
      let escaped!: DurableTransaction;
      expect(() =>
        store.transaction((tx) => {
          escaped = tx;
          tx.appendEvent("run", "submitted", { prompt: "not committed" });
          throw new Error("rollback");
        }),
      ).toThrow("rollback");
      expect(store.events("run", 0, 100)).toEqual([]);
      expect(() => escaped.appendEvent("run", "status", {})).toThrow("finished");
      store.transaction((tx) => tx.appendEvent("run", "submitted", { prompt: "committed" }));
      expect(store.events("run", 0, 100)).toHaveLength(1);
    } finally {
      store.close();
    }
  });

  it("rejects asynchronous transaction callbacks and leaves no partial events", async () => {
    const store = new SqliteDurableStore(":memory:");
    store.acquire();
    try {
      expect(() =>
        store.transaction(async (tx) => {
          tx.appendEvent("run", "submitted", {});
          await Promise.resolve();
          tx.appendEvent("run", "status", {});
        }),
      ).toThrow("synchronous");
      await Promise.resolve();
      expect(store.events("run", 0, 100)).toEqual([]);
    } finally {
      store.close();
    }
  });

  it("rejects invalid event cursors and non-JSON state", () => {
    const store = new SqliteDurableStore(":memory:");
    store.acquire();
    try {
      expect(() => store.events("run", -1, 10)).toThrow("cursor");
      expect(() => store.events("run", 0, 1001)).toThrow("page size");
      expect(() =>
        store.transaction((tx) => tx.appendEvent("run", "submitted", { value: Number.NaN })),
      ).toThrow("JSON");
      expect(store.events("run", 0, 100)).toEqual([]);
    } finally {
      store.close();
    }
  });
});
