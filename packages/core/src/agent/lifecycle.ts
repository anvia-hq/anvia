import type { CompletionResponse, Message, Usage } from "../completion";

type MaybePromise<T> = T | Promise<T>;

export type AgentLifecycleRunEvent = {
  runId: string;
};

export type AgentStartEvent = AgentLifecycleRunEvent & {
  input: Message;
  history: Message[];
  maxTurns: number;
};

export type AgentStepFinishEvent<RawResponse = unknown> = AgentLifecycleRunEvent & {
  step: number;
  response: CompletionResponse<RawResponse>;
  usage: Usage;
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

export type AgentFinishEvent = AgentLifecycleRunEvent & {
  output: string;
  usage: Usage;
  messages: Message[];
};

export type AgentErrorEvent = AgentLifecycleRunEvent & {
  error: unknown;
  usage: Usage;
  messages: Message[];
};

export type AgentLifecycle<RawResponse = unknown> = {
  onStart?(event: AgentStartEvent): MaybePromise<void>;
  onStepFinish?(event: AgentStepFinishEvent<RawResponse>): MaybePromise<void>;
  onToolStart?(event: AgentToolStartEvent): MaybePromise<void>;
  onToolFinish?(event: AgentToolFinishEvent): MaybePromise<void>;
  onFinish?(event: AgentFinishEvent): MaybePromise<void>;
  onError?(event: AgentErrorEvent): MaybePromise<void>;
};

export function composeAgentLifecycle<RawResponse = unknown>(
  first: AgentLifecycle<RawResponse> | undefined,
  second: AgentLifecycle<RawResponse> | undefined,
): AgentLifecycle<RawResponse> | undefined {
  if (first === undefined) return second;
  if (second === undefined) return first;

  return {
    async onStart(event) {
      await first.onStart?.(event);
      await second.onStart?.(event);
    },
    async onStepFinish(event) {
      await first.onStepFinish?.(event);
      await second.onStepFinish?.(event);
    },
    async onToolStart(event) {
      await first.onToolStart?.(event);
      await second.onToolStart?.(event);
    },
    async onToolFinish(event) {
      await first.onToolFinish?.(event);
      await second.onToolFinish?.(event);
    },
    async onFinish(event) {
      await first.onFinish?.(event);
      await second.onFinish?.(event);
    },
    async onError(event) {
      await first.onError?.(event);
      await second.onError?.(event);
    },
  };
}
