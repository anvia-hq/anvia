import type { CompletionResponse, Message, Usage } from "../completion";
import type { DeepReadonly, MaybePromise } from "../internal/type-utils";
import type { MemoryCompactionInfo } from "../memory";
import type { AgentInteractionRequest } from "./interactions";

export type AgentLifecycleRunEvent = {
  runId: string;
};

export type AgentStartEvent = AgentLifecycleRunEvent & {
  input: DeepReadonly<Message>;
  history: DeepReadonly<Message[]>;
  maxTurns: number;
};

export type AgentStepFinishEvent<RawResponse = unknown> = AgentLifecycleRunEvent & {
  step: number;
  response: DeepReadonly<CompletionResponse<RawResponse>>;
  usage: DeepReadonly<Usage>;
};

export type AgentToolStartEvent = AgentLifecycleRunEvent & {
  step: number;
  toolName: string;
  toolCallId?: string | undefined;
  input: unknown;
};

type AgentToolFinishEventBase = AgentToolStartEvent & {
  durationMs: number;
};

export type AgentToolFinishEvent =
  | (AgentToolFinishEventBase & { success: true; output: unknown })
  | (AgentToolFinishEventBase & { success: false; error: unknown });

type AgentFinishEventBase = AgentLifecycleRunEvent & {
  text: string;
  usage: DeepReadonly<Usage>;
  messages: DeepReadonly<Message[]>;
  memoryCompaction?: DeepReadonly<MemoryCompactionInfo> | undefined;
};

export type AgentFinishEvent<Output = string> =
  | (AgentFinishEventBase & {
      status: "completed";
      output: DeepReadonly<Output>;
    })
  | (AgentFinishEventBase & {
      status: "blocked";
      stage: "input" | "output";
    })
  | (AgentFinishEventBase & {
      status: "suspended";
      interaction: DeepReadonly<AgentInteractionRequest>;
    });

export type AgentErrorEvent = AgentLifecycleRunEvent & {
  error: unknown;
  usage: DeepReadonly<Usage>;
  messages: DeepReadonly<Message[]>;
};

export type AgentLifecycle<Output = string, RawResponse = unknown> = {
  onStart?(event: AgentStartEvent): MaybePromise<void>;
  onStepFinish?(event: AgentStepFinishEvent<RawResponse>): MaybePromise<void>;
  onToolStart?(event: AgentToolStartEvent): MaybePromise<void>;
  onToolFinish?(event: AgentToolFinishEvent): MaybePromise<void>;
  onFinish?(event: AgentFinishEvent<Output>): MaybePromise<void>;
  onError?(event: AgentErrorEvent): MaybePromise<void>;
};

export type AgentLifecycleInput<Output = string, RawResponse = unknown> =
  | AgentLifecycle<Output, RawResponse>
  | readonly AgentLifecycle<Output, RawResponse>[];

export function normalizeAgentLifecycle<Output = string, RawResponse = unknown>(
  input: AgentLifecycleInput<Output, RawResponse> | undefined,
): AgentLifecycle<Output, RawResponse> | undefined {
  if (input === undefined) return undefined;

  if (!Array.isArray(input)) {
    return input as AgentLifecycle<Output, RawResponse>;
  }

  return composeLifecycleList(input);
}

export function composeAgentLifecycle<Output = string, RawResponse = unknown>(
  first: AgentLifecycle<Output, RawResponse> | undefined,
  second: AgentLifecycle<Output, RawResponse> | undefined,
): AgentLifecycle<Output, RawResponse> | undefined {
  if (first === undefined) return second;

  if (second === undefined) return first;

  return composeLifecycleList([first, second]);
}

function composeLifecycleList<Output, RawResponse>(
  lifecycles: readonly (AgentLifecycle<Output, RawResponse> | undefined)[],
): AgentLifecycle<Output, RawResponse> | undefined {
  const defined = lifecycles.filter(
    (entry): entry is AgentLifecycle<Output, RawResponse> => entry !== undefined,
  );

  if (defined.length === 0) return undefined;

  if (defined.length === 1) return defined[0];

  const onStarts = defined.flatMap((l) => (l.onStart ? [l.onStart.bind(l)] : []));
  const onStepFinishes = defined.flatMap((l) => (l.onStepFinish ? [l.onStepFinish.bind(l)] : []));
  const onToolStarts = defined.flatMap((l) => (l.onToolStart ? [l.onToolStart.bind(l)] : []));
  const onToolFinishes = defined.flatMap((l) => (l.onToolFinish ? [l.onToolFinish.bind(l)] : []));
  const onFinishes = defined.flatMap((l) => (l.onFinish ? [l.onFinish.bind(l)] : []));
  const onErrors = defined.flatMap((l) => (l.onError ? [l.onError.bind(l)] : []));

  if (
    onStarts.length === 0 &&
    onStepFinishes.length === 0 &&
    onToolStarts.length === 0 &&
    onToolFinishes.length === 0 &&
    onFinishes.length === 0 &&
    onErrors.length === 0
  ) {
    return undefined;
  }

  const composed: AgentLifecycle<Output, RawResponse> = {};

  if (onStarts.length > 0) {
    composed.onStart = async (event) => {
      for (const handler of onStarts) {
        await handler(lifecycleSnapshot(event));
      }
    };
  }

  if (onStepFinishes.length > 0) {
    composed.onStepFinish = async (event) => {
      for (const handler of onStepFinishes) {
        await handler(lifecycleSnapshot(event));
      }
    };
  }

  if (onToolStarts.length > 0) {
    composed.onToolStart = async (event) => {
      for (const handler of onToolStarts) {
        await handler(lifecycleSnapshot(event));
      }
    };
  }

  if (onToolFinishes.length > 0) {
    composed.onToolFinish = async (event) => {
      for (const handler of onToolFinishes) {
        await handler(lifecycleSnapshot(event));
      }
    };
  }

  if (onFinishes.length > 0) {
    composed.onFinish = async (event) => {
      for (const handler of onFinishes) {
        await handler(lifecycleSnapshot(event));
      }
    };
  }

  if (onErrors.length > 0) {
    composed.onError = async (event) => {
      for (const handler of onErrors) {
        await handler(lifecycleSnapshot(event));
      }
    };
  }

  return composed;
}

export function lifecycleSnapshot<T>(value: T): T {
  try {
    return globalThis.structuredClone(value);
  } catch {
    return cloneLifecycleFallback(value, new WeakMap<object, object>());
  }
}

function cloneLifecycleFallback<T>(value: T, seen: WeakMap<object, object>): T {
  if (typeof value !== "object" || value === null) {
    return value;
  }

  const existing = seen.get(value);

  if (existing !== undefined) {
    return existing as T;
  }

  if (Array.isArray(value)) {
    const clone: unknown[] = [];
    seen.set(value, clone);
    clone.push(...value.map((item) => cloneLifecycleFallback(item, seen)));
    return clone as T;
  }

  if (Object.getPrototypeOf(value) !== Object.prototype) {
    return value;
  }

  const clone: Record<string, unknown> = {};
  seen.set(value, clone);
  for (const [key, item] of Object.entries(value)) {
    clone[key] = cloneLifecycleFallback(item, seen);
  }
  return clone as T;
}
