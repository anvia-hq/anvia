import { errorEvent } from "./errors";
import type {
  CreateResumableStreamOptions,
  ResumableStreamEnvelope,
  ResumableStreamRecord,
  ResumableStreamState,
  ResumableStreamStatus,
  ResumableStreamStore,
  ResumableStreamSubscribeInput,
  ResumeStreamEventsOptions,
} from "./types";

type Subscriber<TEvent> = {
  after: number;
  queue: AsyncQueue<ResumableStreamRecord<TEvent>>;
};

type MemoryStream<TEvent> = {
  records: ResumableStreamRecord<TEvent>[];
  status: ResumableStreamStatus;
  subscribers: Set<Subscriber<TEvent>>;
};

type AsyncQueue<T> = AsyncIterable<T> & {
  enqueue(value: T): void;
  close(): void;
  throw(error: unknown): void;
};

export function createResumableStream<TEvent>(
  events: AsyncIterable<TEvent>,
  options: CreateResumableStreamOptions<TEvent>,
): AsyncIterable<ResumableStreamEnvelope<TEvent>> {
  const streamId = options.id;
  let openPromise: Promise<void> | undefined;

  function start(): Promise<void> {
    if (openPromise !== undefined) {
      return openPromise;
    }

    openPromise = options.store.open({ streamId }).then(() => undefined);
    void drainResumableStream(events, options, openPromise);
    return openPromise;
  }

  return {
    async *[Symbol.asyncIterator]() {
      await start();
      yield* resumeStreamEvents({ id: streamId, store: options.store });
    },
  };
}

export async function* resumeStreamEvents<TEvent>(
  options: ResumeStreamEventsOptions<TEvent>,
): AsyncIterable<ResumableStreamEnvelope<TEvent>> {
  const streamId = options.id;
  yield { type: "stream_start", streamId, eventId: 0 };

  const subscribeInput: ResumableStreamSubscribeInput = { streamId };
  if (options.after !== undefined) {
    subscribeInput.after = options.after;
  }
  for await (const record of options.store.subscribe(subscribeInput)) {
    yield recordToEnvelope(record);
  }

  const state = await options.store.status({ streamId });
  yield stateToEndEnvelope<TEvent>(streamId, state);
}

export function createMemoryResumableStreamStore<TEvent = unknown>(): ResumableStreamStore<TEvent> {
  const streams = new Map<string, MemoryStream<TEvent>>();

  function state(stream: MemoryStream<TEvent> | undefined): ResumableStreamState {
    if (stream === undefined) {
      return { status: "missing", lastEventId: 0 };
    }
    return {
      status: stream.status,
      lastEventId: stream.records.at(-1)?.eventId ?? 0,
    };
  }

  return {
    async open(input) {
      const existing = streams.get(input.streamId);
      if (existing !== undefined) {
        closeSubscribers(existing);
      }

      const stream: MemoryStream<TEvent> = {
        records: [],
        status: "running",
        subscribers: new Set(),
      };
      streams.set(input.streamId, stream);
      return state(stream);
    },

    async append(input) {
      const stream = streams.get(input.streamId);
      if (stream === undefined) {
        throw new Error(`Resumable stream "${input.streamId}" is not open`);
      }
      if (stream.status !== "running") {
        throw new Error(`Resumable stream "${input.streamId}" is already ${stream.status}`);
      }

      const record: ResumableStreamRecord<TEvent> = {
        streamId: input.streamId,
        eventId: stream.records.length + 1,
        event: input.event,
        createdAt: new Date(),
      };
      stream.records.push(record);

      for (const subscriber of stream.subscribers) {
        if (record.eventId > subscriber.after) {
          subscriber.queue.enqueue(record);
        }
      }

      return record;
    },

    subscribe(input) {
      const after = input.after ?? 0;
      return {
        [Symbol.asyncIterator](): AsyncIterator<ResumableStreamRecord<TEvent>> {
          const stream = streams.get(input.streamId);
          const queue = createAsyncQueue<ResumableStreamRecord<TEvent>>();
          if (stream === undefined) {
            queue.close();
            return queue[Symbol.asyncIterator]();
          }

          for (const record of stream.records) {
            if (record.eventId > after) {
              queue.enqueue(record);
            }
          }

          if (stream.status !== "running") {
            queue.close();
            return queue[Symbol.asyncIterator]();
          }

          const subscriber: Subscriber<TEvent> = { after, queue };
          stream.subscribers.add(subscriber);
          const iterator = queue[Symbol.asyncIterator]();

          return {
            next: () => iterator.next(),
            async return() {
              stream.subscribers.delete(subscriber);
              queue.close();
              return { value: undefined, done: true };
            },
          };
        },
      };
    },

    async status(input) {
      return state(streams.get(input.streamId));
    },

    async close(input) {
      const stream = streams.get(input.streamId);
      if (stream === undefined) {
        return { status: input.status, lastEventId: 0 };
      }
      stream.status = input.status;
      closeSubscribers(stream);
      return state(stream);
    },
  };
}

async function drainResumableStream<TEvent>(
  events: AsyncIterable<TEvent>,
  options: CreateResumableStreamOptions<TEvent>,
  openPromise: Promise<void>,
): Promise<void> {
  const streamId = options.id;
  try {
    await openPromise;
    for await (const event of events) {
      await options.store.append({ streamId, event });
    }
    await options.store.close({ streamId, status: "completed" });
  } catch (error) {
    const event = errorEvent(error);
    try {
      await options.store.append({ streamId, event });
    } catch {
      // The response iterator reports store-open failures; avoid a background rejection.
    }
    try {
      await options.store.close({ streamId, status: "error" });
    } catch {
      // The store may not have opened.
    }
  }
}

function recordToEnvelope<TEvent>(
  record: ResumableStreamRecord<TEvent>,
): ResumableStreamEnvelope<TEvent> {
  return {
    type: "stream_event",
    streamId: record.streamId,
    eventId: record.eventId,
    event: record.event,
  };
}

function stateToEndEnvelope<TEvent>(
  streamId: string,
  state: ResumableStreamState,
): ResumableStreamEnvelope<TEvent> {
  return {
    type: "stream_end",
    streamId,
    eventId: state.lastEventId,
    status: state.status,
  };
}

function closeSubscribers<TEvent>(stream: MemoryStream<TEvent>): void {
  for (const subscriber of stream.subscribers) {
    subscriber.queue.close();
  }
  stream.subscribers.clear();
}

function createAsyncQueue<T>(): AsyncQueue<T> {
  const values: T[] = [];
  const waiters: Array<{
    resolve: (result: IteratorResult<T>) => void;
    reject: (error: unknown) => void;
  }> = [];
  let closed = false;
  let error: unknown;

  function flush(): void {
    while (waiters.length > 0 && values.length > 0) {
      const waiter = waiters.shift();
      const value = values.shift() as T;
      waiter?.resolve({ value, done: false });
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
    enqueue(value) {
      if (closed) {
        return;
      }
      values.push(value);
      flush();
    },
    close() {
      closed = true;
      flush();
    },
    throw(thrown) {
      closed = true;
      error = thrown;
      flush();
    },
    [Symbol.asyncIterator]() {
      return {
        next() {
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
