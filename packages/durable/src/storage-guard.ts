import { limitedTransaction, type DurableLimits } from "./limits.js";
import { DurableStorageError } from "./errors.js";
import type { DurableStore, DurableTransaction } from "./types.js";

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
  const transaction = <T>(callback: (tx: DurableTransaction) => T): T => {
    check();
    let callbackFailed = false;
    let callbackError: unknown;
    try {
      return store.transaction((tx) => {
        const guarded = new Proxy(tx, {
          get(target, key) {
            const method: unknown = Reflect.get(target, key);
            if (typeof method !== "function") return method;
            return (...args: unknown[]) => {
              check();
              try {
                return Reflect.apply(method, target, args);
              } catch (error) {
                throw fail(error);
              }
            };
          },
        });
        try {
          const result = callback(limitedTransaction(guarded, limits));
          check(); // A caught write failure must roll back, never commit a partial transaction.
          return result;
        } catch (error) {
          callbackFailed = true;
          callbackError = error;
          throw error;
        }
      });
    } catch (error) {
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
      return (...args: unknown[]) => {
        check();
        try {
          return Reflect.apply(method, target, args);
        } catch (error) {
          throw fail(error);
        }
      };
    },
  });
}
