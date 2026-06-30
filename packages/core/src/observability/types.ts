import type {
  CompletionModelCapabilities,
  CompletionRequest,
  CompletionResponse,
  JsonObject,
  JsonValue,
  Message,
  ToolCall,
  ToolDefinition,
  ToolResultContent,
  Usage,
} from "../completion";
import type { AgentDeltaEvent } from "../request/types";
import type { ToolCallStreamEvent } from "../tool";

export type AgentTraceInfo = {
  traceId?: string | undefined;
  observationId?: string | undefined;
};

export type AgentTraceOptions = {
  name?: string | undefined;
  userId?: string | undefined;
  sessionId?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
  tags?: string[] | undefined;
  version?: string | undefined;
  traceId?: string | undefined;
  failOnObserverError?: boolean | undefined;
};

export type AgentRunPromptRef = {
  name: string;
  version?: number | undefined;
};

export type AgentRunStartArgs = {
  agentName?: string | undefined;
  agentDescription?: string | undefined;
  instructions?: string | undefined;
  trace?: AgentTraceOptions | undefined;
  prompt: Message;
  promptRef?: AgentRunPromptRef | undefined;
  history: Message[];
  maxTurns: number;
};

export type AgentRunEndArgs = {
  output: string;
  usage: Usage;
  messages: Message[];
};

export type AgentRunErrorArgs = {
  error: unknown;
  usage: Usage;
  messages: Message[];
};

export type AgentGenerationStartArgs = {
  turn: number;
  request: CompletionRequest;
  providerRequest?: JsonObject | undefined;
  modelInfo?: {
    provider: string;
    defaultModel: string;
    capabilities?: CompletionModelCapabilities | undefined;
  };
};

export type AgentGenerationEndArgs<RawResponse = unknown> = {
  turn: number;
  response: CompletionResponse<RawResponse>;
  firstDeltaMs?: number | undefined;
};

export type AgentGenerationErrorArgs = {
  turn: number;
  error: unknown;
};

export type AgentGenerationUpdateArgs = {
  turn: number;
  delta: AgentDeltaEvent;
};

export type AgentRunEventArgs = {
  name: string;
  attributes?: Record<string, JsonValue | undefined> | undefined;
  level?: "DEFAULT" | "WARNING" | "ERROR" | undefined;
  timestamp?: Date | string | undefined;
};

export type AgentToolStartArgs = {
  turn: number;
  toolCall: ToolCall;
  toolName: string;
  args: string;
  internalCallId: string;
  toolCallId?: string | undefined;
  toolDefinition?: ToolDefinition | undefined;
  toolMetadata?: JsonObject | undefined;
};

export type AgentToolEndArgs = AgentToolStartArgs & {
  result: string;
  structuredResult?: ToolResultContent[] | undefined;
  skipped: boolean;
};

export type AgentToolErrorArgs = AgentToolStartArgs & {
  error: unknown;
};

export type AgentToolStreamEventArgs = AgentToolStartArgs & {
  event: ToolCallStreamEvent;
};

export interface AgentGenerationObserver {
  end(args: AgentGenerationEndArgs): void | Promise<void>;
  error?(args: AgentGenerationErrorArgs): void | Promise<void>;
  update?(args: AgentGenerationUpdateArgs): void | Promise<void>;
}

export interface AgentToolObserver {
  streamEvent?(args: AgentToolStreamEventArgs): void | Promise<void>;
  end(args: AgentToolEndArgs): void | Promise<void>;
  error?(args: AgentToolErrorArgs): void | Promise<void>;
}

export interface AgentRunObserver {
  readonly trace?: AgentTraceInfo | undefined;
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
  flush?(): void | Promise<void>;
  shutdown?(): void | Promise<void>;
}

export type AgentObserverRegistration = {
  observer: AgentObserver;
  failOnObserverError?: boolean | undefined;
};

export type ObserveOptions = {
  failOnObserverError?: boolean | undefined;
};

export function createObserver(observer: AgentObserver): AgentObserver {
  return observer;
}
