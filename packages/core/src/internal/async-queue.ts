type AsyncQueueWaiter<T> = {
  resolve: (result: IteratorResult<T>) => void;
  reject: (error: unknown) => void;
};

type QueueCloseOptions = { discardPending?: boolean };

export type AsyncQueue<T> = AsyncIterable<T> & {
  enqueue(value: T): void;
  close(options?: QueueCloseOptions): void;
  throw(error: unknown, options?: QueueCloseOptions): void;
};

export function createAsyncQueue<T>(): AsyncQueue<T> {
  const values: T[] = [];
  const waiters: AsyncQueueWaiter<T>[] = [];
  let closed = false;
  let error: unknown;

  function flush(): void {
    while (waiters.length > 0 && values.length > 0) {
      const waiter = waiters.shift();
      const value = values.shift() as T;
      if (waiter !== undefined) {
        waiter.resolve({ value, done: false });
      }
    }

    if (values.length > 0 || waiters.length === 0 || !closed) {
      return;
    }

    while (waiters.length > 0) {
      const waiter = waiters.shift();
      if (waiter === undefined) {
        continue;
      }
      if (error !== undefined) {
        waiter.reject(error);
      } else {
        waiter.resolve({ value: undefined, done: true });
      }
    }
  }

  return {
    enqueue(value: T): void {
      if (closed) {
        return;
      }
      values.push(value);
      flush();
    },
    close(options?: QueueCloseOptions): void {
      if (options?.discardPending) values.length = 0;
      closed = true;
      flush();
    },
    throw(thrown: unknown, options?: QueueCloseOptions): void {
      if (options?.discardPending) values.length = 0;
      closed = true;
      error = thrown;
      flush();
    },
    [Symbol.asyncIterator](): AsyncIterator<T> {
      return {
        next(): Promise<IteratorResult<T>> {
          if (values.length > 0) {
            const value = values.shift() as T;
            return Promise.resolve({ value, done: false });
          }
          if (error !== undefined) {
            return Promise.reject(error);
          }
          if (closed) {
            return Promise.resolve({ value: undefined, done: true });
          }
          return new Promise((resolve, reject) => {
            waiters.push({ resolve, reject });
          });
        },
      };
    },
  };
}
