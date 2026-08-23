import type { AgentInteractionRequest } from "../agent/interactions";
import type { AgentDeltaEvent, AgentRunLink } from "../agent/run-types";
import type {
  CompletionModelCapabilities,
  CompletionRequest,
  CompletionResponse,
  CompletionSource,
  JsonObject,
  Message,
  ProviderToolCall,
  ToolCallPart,
  ToolDefinition,
  ToolResultContentPart,
  Usage,
} from "../completion";
import type { DeepReadonly } from "../internal/type-utils";
import type { ToolCallStreamEvent } from "../tool";

export type AgentTraceInfo = {
  readonly observer: string;
  readonly traceId?: string | undefined;
  readonly observationId?: string | undefined;
};

export type AgentObserverTraceInfo = Omit<AgentTraceInfo, "observer">;

export type AgentTraceOptions = {
  readonly name?: string | undefined;
  readonly userId?: string | undefined;
  readonly sessionId?: string | undefined;
  readonly metadata?: DeepReadonly<JsonObject> | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly version?: string | undefined;
  readonly traceId?: string | undefined;
  readonly promptRef?: AgentRunPromptRef | undefined;
};

export type AgentRunPromptRef = {
  readonly name: string;
  readonly version?: number | undefined;
};

export type AgentRunStartArgs = {
  readonly runId: string;
  readonly agentName?: string | undefined;
  readonly agentDescription?: string | undefined;
  readonly instructions?: string | undefined;
  readonly trace?: DeepReadonly<AgentTraceOptions> | undefined;
  readonly prompt: DeepReadonly<Message>;
  readonly promptRef?: DeepReadonly<AgentRunPromptRef> | undefined;
  readonly history: readonly DeepReadonly<Message>[];
  readonly maxTurns: number;
};

type AgentRunEndArgsBase = {
  readonly runId: string;
  readonly text: string;
  readonly usage: DeepReadonly<Usage>;
  readonly messages: readonly DeepReadonly<Message>[];
  readonly sources?: readonly DeepReadonly<CompletionSource>[] | undefined;
  readonly providerToolCalls?: readonly DeepReadonly<ProviderToolCall>[] | undefined;
  readonly resumedFrom?: DeepReadonly<AgentRunLink> | undefined;
};

export type AgentRunEndArgs =
  | (AgentRunEndArgsBase & {
      readonly status: "completed";
      readonly output: unknown;
    })
  | (AgentRunEndArgsBase & {
      readonly status: "blocked";
      readonly stage: "input" | "output";
    })
  | (AgentRunEndArgsBase & {
      readonly status: "suspended";
      readonly interaction: DeepReadonly<AgentInteractionRequest>;
    });

export type AgentRunErrorArgs = {
  readonly error: unknown;
  readonly usage: DeepReadonly<Usage>;
  readonly messages: readonly DeepReadonly<Message>[];
};

export type AgentGenerationModelInfo = {
  readonly provider: string;
  readonly modelId: string;
  readonly capabilities?: DeepReadonly<CompletionModelCapabilities> | undefined;
};

export type AgentGenerationStartArgs = {
  readonly turn: number;
  readonly request: DeepReadonly<CompletionRequest>;
  readonly providerRequest?: DeepReadonly<JsonObject> | undefined;
  readonly modelInfo?: DeepReadonly<AgentGenerationModelInfo> | undefined;
};

export type AgentGenerationEndArgs<RawResponse = unknown> = {
  readonly turn: number;
  readonly response: DeepReadonly<CompletionResponse<RawResponse>>;
  readonly firstDeltaMs?: number | undefined;
};

export type AgentGenerationErrorArgs = {
  readonly turn: number;
  readonly error: unknown;
};

export type AgentGenerationUpdateArgs = {
  readonly turn: number;
  readonly delta: DeepReadonly<AgentDeltaEvent>;
};

export type AgentRunEventArgs = {
  readonly name: string;
  readonly attributes?: DeepReadonly<JsonObject> | undefined;
  readonly level?: "DEFAULT" | "WARNING" | "ERROR" | undefined;
  readonly timestamp?: string | undefined;
};

export type AgentToolStartArgs = {
  readonly turn: number;
  readonly toolCall: DeepReadonly<ToolCallPart>;
  readonly toolName: string;
  readonly args: string;
  readonly internalCallId: string;
  readonly toolCallId?: string | undefined;
  readonly toolDefinition?: DeepReadonly<ToolDefinition> | undefined;
  readonly toolMetadata?: DeepReadonly<JsonObject> | undefined;
};

export type AgentToolEndArgs = AgentToolStartArgs & {
  readonly result: string;
  readonly structuredResult?: readonly DeepReadonly<ToolResultContentPart>[] | undefined;
  readonly skipped: boolean;
};

export type AgentToolErrorArgs = AgentToolStartArgs & {
  readonly error: unknown;
};

export type AgentToolSuspendedArgs = AgentToolStartArgs & {
  readonly interaction: DeepReadonly<AgentInteractionRequest>;
};

export type AgentToolStreamEventArgs = AgentToolStartArgs & {
  readonly event: DeepReadonly<ToolCallStreamEvent>;
};

export interface AgentGenerationObserver {
  end(args: AgentGenerationEndArgs): void | Promise<void>;
  error?(args: AgentGenerationErrorArgs): void | Promise<void>;
  update?(args: AgentGenerationUpdateArgs): void | Promise<void>;
}

export interface AgentToolObserver {
  streamEvent?(args: AgentToolStreamEventArgs): void | Promise<void>;
  end(args: AgentToolEndArgs): void | Promise<void>;
  suspend?(args: AgentToolSuspendedArgs): void | Promise<void>;
  error?(args: AgentToolErrorArgs): void | Promise<void>;
}

export interface AgentRunObserver {
  readonly trace?: AgentObserverTraceInfo | undefined;
  startGeneration?(
    args: AgentGenerationStartArgs,
  ): AgentGenerationObserver | undefined | Promise<AgentGenerationObserver | undefined>;
  startTool?(
    args: AgentToolStartArgs,
  ): AgentToolObserver | undefined | Promise<AgentToolObserver | undefined>;
  end(args: AgentRunEndArgs): void | Promise<void>;
  error?(args: AgentRunErrorArgs): void | Promise<void>;
  event?(args: AgentRunEventArgs): void | Promise<void>;
}

export interface AgentObserver {
  startRun(
    args: AgentRunStartArgs,
  ): AgentRunObserver | undefined | Promise<AgentRunObserver | undefined>;
}

export type AgentObserverMap = Readonly<Record<string, AgentObserver>>;

export type AgentObserverErrorPolicy = "ignore" | "throw";

export type AgentObservabilityOptions<Observers extends AgentObserverMap = AgentObserverMap> = {
  readonly observers: Observers;
  readonly primaryTrace?: Extract<keyof Observers, string> | undefined;
  readonly errorPolicy?: AgentObserverErrorPolicy | undefined;
};
