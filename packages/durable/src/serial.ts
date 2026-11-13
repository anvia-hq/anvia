import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Serializes a store's transactions and rejects nesting. A transaction is a queue entry: it starts
 * only when the previous one has committed or rolled back. Code running inside a transaction's
 * async context may read through the store directly, but may not open another transaction.
 */
export class SerialGate {
  private tail: Promise<unknown> = Promise.resolve();
  private readonly context = new AsyncLocalStorage<true>();

  get inside(): boolean {
    return this.context.getStore() === true;
  }

  /** Runs `fn` as the next transaction. Throws when called from inside a transaction. */
  transaction<T>(fn: () => Promise<T>): Promise<T> {
    if (this.inside)
      return Promise.reject(new Error("Nested durable transactions are not supported."));
    return this.enqueue(() => this.context.run(true, fn));
  }

  /** Runs a read after the open transaction, or at once when called from inside one. */
  read<T>(fn: () => Promise<T> | T): Promise<T> {
    if (this.inside) return Promise.resolve().then(fn);
    return this.enqueue(async () => fn());
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn, fn);
    this.tail = result.catch(() => undefined);
    return result;
  }
}
