import { AsyncLocalStorage } from "node:async_hooks";
import type { DurableStore, DurableTransactionOptions } from "./types.js";

/** The run a worker is executing. Every transaction started inside it is fenced by its claim. */
export const claimContext = new AsyncLocalStorage<{ runId: string; claimId: string }>();

/**
 * Makes each transaction begin by asserting the current claim, so a worker that lost its lease
 * cannot commit anything for the run. Using the async context covers every write path of an
 * execution at once, instead of relying on each one to remember the check.
 */
export function fenceStore(store: DurableStore): DurableStore {
  if (store.transaction === undefined) return store;

  return new Proxy(store, {
    get(target, key) {
      const value: unknown = Reflect.get(target, key);

      if (key === "transaction") {
        return async (
          callback: Parameters<DurableStore["transaction"]>[0],
          options?: DurableTransactionOptions,
        ) =>
          target.transaction(async (tx) => {
            const claim = claimContext.getStore();

            // A read cannot commit a stale write, and `FOR SHARE` is not allowed in a read-only one.
            if (claim !== undefined && options?.readOnly !== true)
              await tx.assertClaim?.(claim.runId, claim.claimId);

            return callback(tx);
          }, options);
      }

      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
