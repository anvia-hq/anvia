import type {
  CompletionFinishReason,
  CompletionRequest,
  CompletionResponse,
  CompletionSource,
  ContextUsage,
  Message as MessageType,
  ProviderToolCall,
  ReasoningContentType,
  ToolCallArgumentsMode,
  ToolCallPart,
  ToolInteractionResponsePart,
  ToolResultContentPart,
  ToolResultOutput,
  Usage,
  UserMessage,
} from "../completion/index";
import type { GuardrailDecisionRecord, GuardrailPolicyInput } from "../guardrails";
import type { MemoryCompactionInfo, MemoryScope } from "../memory";
import type {
  AgentGenerationModelInfo,
  AgentTraceInfo,
  AgentTraceOptions,
} from "../observability/types";
import type { RetrySetting } from "../retry";
import type { AgentMiddleware } from "../tool";
import type {
  AgentContinuation,
  AgentInteractionRequest,
  AgentInteractionResponse,
} from "./interactions";
import type { AgentLifecycle } from "./lifecycle";

export type AgentPrompt = string | UserMessage;

export type AgentInput =
  | {
      prompt: AgentPrompt;
      messages?: never;
      session?: MemoryScope | undefined;
      continuation?: never;
      response?: never;
    }
  | {
      messages: readonly MessageType[];
      prompt?: never;
      session?: never;
      continuation?: never;
      response?: never;
    }
  | {
      continuation: AgentContinuation;
      response: AgentInteractionResponse;
      prompt?: never;
      messages?: never;
      session?: never;
    };

export type AgentSteerInput =
  | { prompt: AgentPrompt; messages?: never }
  | { messages: readonly UserMessage[]; prompt?: never };

export type AgentRunSettings<Output = string, RawResponse = unknown> = {
  maxTurns?: number | undefined;
  retries?: RetrySetting | undefined;
  abortSignal?: AbortSignal | undefined;
  lifecycle?: AgentLifecycle<Output, RawResponse> | undefined;
  guardrails?: GuardrailPolicyInput | undefined;
  toolConcurrency?: number | undefined;
  middlewares?: readonly AgentMiddleware[] | undefined;
  trace?: AgentTraceOptions | undefined;
};

export type AgentRunOptions<Output = string, RawResponse = unknown> = AgentInput &
  AgentRunSettings<Output, RawResponse>;

export type AgentRunLink = Readonly<{
  runId: string;
  interactionId: string;
}>;

export type AgentResultBase = {
  runId: string;
  text: string;
  usage: Usage;
  finishReason?: CompletionFinishReason | undefined;
  providerFinishReason?: string | undefined;
  contextUsage?: ContextUsage | undefined;
  messages: MessageType[];
  trace?: AgentTraceInfo | undefined;
  guardrails?: GuardrailDecisionRecord[] | undefined;
  sources?: CompletionSource[] | undefined;
  providerToolCalls?: ProviderToolCall[] | undefined;
  memoryCompaction?: MemoryCompactionInfo | undefined;
  resumedFrom?: AgentRunLink | undefined;
};

export type AgentResponse<Output = string> = AgentResultBase & {
  status: "completed";
  output: Output;
};

export type AgentBlockedResult = AgentResultBase & {
  status: "blocked";
  stage: "input" | "output";
};

export type AgentSuspendedResult = AgentResultBase & {
  status: "suspended";
  interaction: AgentInteractionRequest;
  continuation: AgentContinuation;
};

export type AgentResult<Output = string> =
  | AgentResponse<Output>
  | AgentBlockedResult
  | AgentSuspendedResult;

export type AgentDeltaEvent =
  | { type: "text_delta"; delta: string }
  | {
      type: "reasoning_delta";
      delta: string;
      id?: string;
      contentType?: ReasoningContentType;
      signature?: string;
    }
  | { type: "tool_call"; toolCall: ToolCallPart }
  | { type: "source"; source: CompletionSource }
  | { type: "provider_tool_call"; toolCall: ProviderToolCall };

export type AgentErrorStreamEvent = {
  type: "error";
  error: unknown;
  usage: Usage;
};

export type AgentToolCallDeltaEvent = {
  type: "tool_call_delta";
  turn: number;
  id: string;
  callId?: string;
  name?: string;
  argumentsDelta?: string;
  argumentsMode?: ToolCallArgumentsMode;
  signature?: string;
};

export type AgentMemoryCompactionEvent = MemoryCompactionInfo & {
  type: "memory_compaction";
};

export type AgentInteractionResponseEvent = {
  type: "interaction_response";
  response: ToolInteractionResponsePart;
  sourceRunId: string;
};

export type AgentSteerReceipt = Readonly<{
  id: string;
  status: "queued";
}>;

export type AgentSteeringAppliedEvent = {
  type: "steering_applied";
  id: string;
  turn: number;
};

type AgentChildStreamEventBase<Output = string, RawResponse = unknown> =
  | {
      type: "turn_start";
      turn: number;
      prompt: MessageType;
      history: MessageType[];
    }
  | {
      type: "generation_start";
      turn: number;
      request: CompletionRequest;
      modelInfo: AgentGenerationModelInfo;
    }
  | {
      type: "text_delta";
      turn: number;
      delta: string;
    }
  | {
      type: "reasoning_delta";
      turn: number;
      delta: string;
      id?: string;
      contentType?: ReasoningContentType;
      signature?: string;
    }
  | {
      type: "tool_call";
      turn: number;
      toolCall: ToolCallPart;
    }
  | {
      type: "source";
      turn: number;
      source: CompletionSource;
    }
  | {
      type: "provider_tool_call";
      turn: number;
      toolCall: ProviderToolCall;
    }
  | {
      type: "tool_result";
      turn: number;
      toolName: string;
      toolCallId: string;
      callId?: string;
      internalCallId: string;
      args: string;
      output: ToolResultOutput;
      result: string;
      structuredResult?: readonly ToolResultContentPart[] | undefined;
    }
  | {
      type: "turn_end";
      turn: number;
      response: CompletionResponse<RawResponse>;
      firstDeltaMs?: number | undefined;
    }
  | {
      type: "guardrail_decision";
      turn?: number | undefined;
      decision: GuardrailDecisionRecord;
    }
  | AgentMemoryCompactionEvent
  | AgentInteractionResponseEvent
  | AgentSteeringAppliedEvent
  | {
      type: "final";
      result: AgentResult<Output>;
    }
  | AgentErrorStreamEvent;

export type AgentChildStreamEvent<Output = string, RawResponse = unknown> =
  | AgentChildStreamEventBase<Output, RawResponse>
  | AgentToolCallDeltaEvent;

type AgentToolStreamEvent = {
  type: "agent_tool_event";
  turn: number;
  toolName: string;
  toolCallId?: string;
  internalCallId: string;
  agentId: string;
  agentName?: string;
  event: AgentChildStreamEvent<unknown, unknown>;
};

export type AgentStreamEvent<Output = string, RawResponse = unknown> =
  | AgentChildStreamEvent<Output, RawResponse>
  | AgentToolStreamEvent;

export interface AgentStream<Event = AgentStreamEvent> extends AsyncIterable<Event> {
  steer(input: AgentSteerInput): AgentSteerReceipt;
}
