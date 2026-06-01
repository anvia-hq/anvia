import type { Hono } from "hono";
import { stream as streamResponse } from "hono/streaming";
import type {
  StudioObservabilityEvent,
  StudioObservabilityEventType,
  StudioPipelineLogStore,
  StudioSessionStore,
  StudioTrace,
  StudioTraceStore,
  StudioTraceSummary,
} from "../types";
import type { ResolvedStores } from "./shared";

type ObservabilitySubscription = {
  close: () => void;
  next: () => Promise<IteratorResult<StudioObservabilityEvent>>;
  push: (event: StudioObservabilityEvent) => void;
};

const defaultBufferSize = 1000;

export class StudioObservabilityHub {
  private readonly subscriptions = new Set<ObservabilitySubscription>();

  emit(event: StudioObservabilityEvent): void {
    for (const subscription of this.subscriptions) {
      subscription.push(event);
    }
  }

  subscribe(
    options: { types?: Set<StudioObservabilityEventType> } = {},
  ): ObservabilitySubscription {
    const subscription = createSubscription(options.types);
    this.subscriptions.add(subscription);
    return {
      close: () => {
        subscription.close();
        this.subscriptions.delete(subscription);
      },
      next: subscription.next,
      push: subscription.push,
    };
  }
}

export function observeStores(stores: ResolvedStores, hub: StudioObservabilityHub): ResolvedStores {
  return {
    ...stores,
    ...(stores.sessions === undefined
      ? {}
      : { sessions: observeSessionStore(stores.sessions, hub) }),
    ...(stores.traces === undefined ? {} : { traces: observeTraceStore(stores.traces, hub) }),
    ...(stores.pipelineLogs === undefined
      ? {}
      : { pipelineLogs: observePipelineLogStore(stores.pipelineLogs, hub) }),
  };
}

export function registerObservabilityRoutes(app: Hono, hub: StudioObservabilityHub): void {
  app.get("/observability/events", (c) => {
    const types = parseEventTypes(c.req.query("type"));
    if (types === false) {
      return c.json(
        {
          error: {
            code: "bad_request",
            message: "type must include session_log, pipeline_log, or trace",
          },
        },
        400,
      );
    }

    c.header("content-type", "application/x-ndjson; charset=utf-8");
    c.header("cache-control", "no-cache, no-transform");
    c.header("connection", "keep-alive");
    c.header("transfer-encoding", "chunked");
    c.header("x-accel-buffering", "no");

    return streamResponse(c, async (stream) => {
      const subscription = hub.subscribe(types === undefined ? {} : { types });
      try {
        while (true) {
          const next = await subscription.next();
          if (next.done === true) {
            break;
          }
          await stream.write(`${JSON.stringify(next.value)}\n`);
        }
      } finally {
        subscription.close();
      }
    });
  });
}

function createSubscription(
  types: Set<StudioObservabilityEventType> | undefined,
): ObservabilitySubscription {
  const values: StudioObservabilityEvent[] = [];
  const resolvers: Array<(value: IteratorResult<StudioObservabilityEvent>) => void> = [];
  let closed = false;

  return {
    close() {
      closed = true;
      for (const resolve of resolvers.splice(0)) {
        resolve({ done: true, value: undefined });
      }
    },
    next() {
      const value = values.shift();
      if (value !== undefined) {
        return Promise.resolve({ done: false, value });
      }
      if (closed) {
        return Promise.resolve({ done: true, value: undefined });
      }
      return new Promise((resolve) => resolvers.push(resolve));
    },
    push(event) {
      if (closed || (types !== undefined && !types.has(event.type))) {
        return;
      }
      const resolve = resolvers.shift();
      if (resolve !== undefined) {
        resolve({ done: false, value: event });
        return;
      }
      if (values.length >= defaultBufferSize) {
        values.shift();
      }
      values.push(event);
    },
  };
}

function observeSessionStore(
  store: StudioSessionStore,
  hub: StudioObservabilityHub,
): StudioSessionStore {
  return new Proxy(store, {
    get(target, property, receiver) {
      if (property !== "appendSessionLog") {
        return boundProperty(target, property, receiver);
      }
      const appendSessionLog = target.appendSessionLog?.bind(target);
      if (appendSessionLog === undefined) {
        return undefined;
      }
      return async (...args: Parameters<NonNullable<StudioSessionStore["appendSessionLog"]>>) => {
        const log = await appendSessionLog(...args);
        hub.emit({ type: "session_log", log });
        return log;
      };
    },
  });
}

function observePipelineLogStore(
  store: StudioPipelineLogStore,
  hub: StudioObservabilityHub,
): StudioPipelineLogStore {
  return new Proxy(store, {
    get(target, property, receiver) {
      if (property !== "appendPipelineLog") {
        return boundProperty(target, property, receiver);
      }
      const appendPipelineLog = target.appendPipelineLog.bind(target);
      return async (...args: Parameters<StudioPipelineLogStore["appendPipelineLog"]>) => {
        const log = await appendPipelineLog(...args);
        hub.emit({ type: "pipeline_log", log });
        return log;
      };
    },
  });
}

function observeTraceStore(store: StudioTraceStore, hub: StudioObservabilityHub): StudioTraceStore {
  return new Proxy(store, {
    get(target, property, receiver) {
      if (property !== "saveTrace") {
        return boundProperty(target, property, receiver);
      }
      const saveTrace = target.saveTrace.bind(target);
      return async (...args: Parameters<StudioTraceStore["saveTrace"]>) => {
        const trace = await saveTrace(...args);
        hub.emit({ type: "trace", trace: traceSummary(trace) });
        return trace;
      };
    },
  });
}

function boundProperty<T extends object>(
  target: T,
  property: string | symbol,
  receiver: unknown,
): unknown {
  const value = Reflect.get(target, property, receiver);
  return typeof value === "function" ? value.bind(target) : value;
}

function parseEventTypes(
  value: string | undefined,
): Set<StudioObservabilityEventType> | undefined | false {
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }

  const types = new Set<StudioObservabilityEventType>();
  for (const type of value.split(",")) {
    const trimmed = type.trim();
    if (!isEventType(trimmed)) {
      return false;
    }
    types.add(trimmed);
  }
  return types;
}

function isEventType(value: string): value is StudioObservabilityEventType {
  return value === "session_log" || value === "pipeline_log" || value === "trace";
}

function traceSummary(trace: StudioTrace): StudioTraceSummary {
  return {
    id: trace.id,
    sessionId: trace.sessionId,
    ...(trace.name === undefined ? {} : { name: trace.name }),
    status: trace.status,
    startedAt: trace.startedAt,
    ...(trace.endedAt === undefined ? {} : { endedAt: trace.endedAt }),
    ...(trace.durationMs === undefined ? {} : { durationMs: trace.durationMs }),
    ...(trace.output === undefined ? {} : { output: trace.output }),
    ...(trace.error === undefined ? {} : { error: trace.error }),
    ...(trace.usage === undefined ? {} : { usage: trace.usage }),
    ...(trace.metadata === undefined ? {} : { metadata: trace.metadata }),
    observationCount: trace.observations.length,
  };
}
