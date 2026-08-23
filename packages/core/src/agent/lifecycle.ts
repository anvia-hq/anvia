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

export function composeAgentLifecycle<Output = string, RawResponse = unknown>(
  first: AgentLifecycle<Output, RawResponse> | undefined,
  second: AgentLifecycle<Output, RawResponse> | undefined,
): AgentLifecycle<Output, RawResponse> | undefined {
  if (first === undefined) return second;
  if (second === undefined) return first;

  return {
    async onStart(event) {
      await first.onStart?.(lifecycleSnapshot(event));
      await second.onStart?.(lifecycleSnapshot(event));
    },
    async onStepFinish(event) {
      await first.onStepFinish?.(lifecycleSnapshot(event));
      await second.onStepFinish?.(lifecycleSnapshot(event));
    },
    async onToolStart(event) {
      await first.onToolStart?.(lifecycleSnapshot(event));
      await second.onToolStart?.(lifecycleSnapshot(event));
    },
    async onToolFinish(event) {
      await first.onToolFinish?.(lifecycleSnapshot(event));
      await second.onToolFinish?.(lifecycleSnapshot(event));
    },
    async onFinish(event) {
      await first.onFinish?.(lifecycleSnapshot(event));
      await second.onFinish?.(lifecycleSnapshot(event));
    },
    async onError(event) {
      await first.onError?.(lifecycleSnapshot(event));
      await second.onError?.(lifecycleSnapshot(event));
    },
  };
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
