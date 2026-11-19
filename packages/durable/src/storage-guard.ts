import { limitedTransaction, type DurableLimits } from "./limits.js";
import { DurableClaimLostError, DurableStorageError } from "./errors.js";
import type { DurableStore, DurableTransaction, DurableTransactionOptions } from "./types.js";

/** A journal failure poisons the owner, even when application code catches the error. */
export function guardStore(
  store: DurableStore,
  onFailure: (error: DurableStorageError) => void,
  limits: DurableLimits,
): DurableStore {
  let failure: DurableStorageError | undefined;
  const fail = (cause: unknown) => {
    if (failure === undefined) {
      failure = new DurableStorageError("Durable storage failed; close and reopen the runtime.", {
        cause,
      });
      onFailure(failure);
    }
    return failure;
  };
  const check = () => {
    if (failure !== undefined) throw failure;
  };
  const transaction = async <T>(
    callback: (tx: DurableTransaction) => Promise<T>,
    options?: DurableTransactionOptions,
  ): Promise<T> => {
    check();
    let callbackFailed = false;
    let callbackError: unknown;
    try {
      return await store.transaction(async (tx) => {
        const guarded = new Proxy(tx, {
          get(target, key) {
            const method: unknown = Reflect.get(target, key);
            if (typeof method !== "function") return method;
            return async (...args: unknown[]) => {
              check();
              try {
                return await Reflect.apply(method, target, args);
              } catch (error) {
                // Losing a claim stops one run; it is not a journal failure.
                if (error instanceof DurableClaimLostError) throw error;
                throw fail(error);
              }
            };
          },
        });
        try {
          const result = await callback(limitedTransaction(guarded, limits));
          check(); // A caught write failure must roll back, never commit a partial transaction.
          return result;
        } catch (error) {
          callbackFailed = true;
          callbackError = error;
          throw error;
        }
      }, options);
    } catch (error) {
      if (error instanceof DurableClaimLostError) throw error;
      if (!callbackFailed || error !== callbackError) throw fail(error);
      throw failure ?? error;
    }
  };
  return new Proxy(store, {
    get(target, key) {
      if (key === "transaction") return transaction;
      const method: unknown = Reflect.get(target, key);
      if (typeof method !== "function") return method;
      if (key === "close") return method.bind(target);
      if (key === "claim" || key === "renew" || key === "release") {
        // Lease traffic fails transiently (network, failover); the runtime retries it and
        // stops affected runs itself, so it must not poison the journal.
        return async (...args: unknown[]) => {
          check();
          return Reflect.apply(method, target, args);
        };
      }
      return async (...args: unknown[]) => {
        check();
        try {
          return await Reflect.apply(method, target, args);
        } catch (error) {
          throw fail(error);
        }
      };
    },
  });
}
