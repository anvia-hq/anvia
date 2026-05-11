import type {
  CompletionModelCapabilities,
  CompletionRequest,
  CompletionResponse,
  JsonObject,
  Message,
  ToolCall,
  ToolDefinition,
  Usage,
} from "../completion";
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

export type AgentRunStartArgs = {
  agentName?: string | undefined;
  agentDescription?: string | undefined;
  instructions?: string | undefined;
  trace?: AgentTraceOptions | undefined;
  prompt: Message;
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
