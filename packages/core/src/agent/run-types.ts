import type {
  CompletionRequest,
  CompletionResponse,
  CompletionSource,
  ContextUsage,
  Message as MessageType,
  ProviderToolCall,
  ReasoningContentType,
  ToolCall,
  ToolCallArgumentsMode,
  ToolResultContent,
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
import type { AgentLifecycle } from "./lifecycle";

export type AgentPrompt = string | UserMessage;

export type AgentInput =
  | {
      prompt: AgentPrompt;
      messages?: never;
      session?: MemoryScope | undefined;
    }
  | {
      messages: readonly MessageType[];
      prompt?: never;
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

type AgentResultBase = {
  runId: string;
  text: string;
  usage: Usage;
  contextUsage?: ContextUsage | undefined;
  messages: MessageType[];
  trace?: AgentTraceInfo | undefined;
  guardrails?: GuardrailDecisionRecord[] | undefined;
  sources?: CompletionSource[] | undefined;
  providerToolCalls?: ProviderToolCall[] | undefined;
  memoryCompaction?: MemoryCompactionInfo | undefined;
};

export type AgentResponse<Output = string> = AgentResultBase & {
  status: "completed";
  output: Output;
};

export type AgentBlockedResult = AgentResultBase & {
  status: "blocked";
  stage: "input" | "output";
};

export type AgentApprovalRequiredResult = {
  status: "approval_required";
  runId: string;
  approval: AgentToolApprovalRequest;
  usage: Usage;
  messages: MessageType[];
  memoryCompaction?: MemoryCompactionInfo | undefined;
};

export type AgentResult<Output = string> =
  | AgentResponse<Output>
  | AgentBlockedResult
  | AgentApprovalRequiredResult;

export type AgentToolApprovalRequest = {
  id: string;
  toolName: string;
  toolCallId?: string | undefined;
  reason?: string | undefined;
  input: unknown;
};

export type AgentApprovalRequiredEvent = Omit<AgentApprovalRequiredResult, "status"> & {
  type: "approval_required";
};

export type AgentApprovalDecision =
  | { approved: true; reason?: string }
  | { approved: false; reason?: string };

export type AgentDeltaEvent =
  | { type: "text_delta"; delta: string }
  | {
      type: "reasoning_delta";
      delta: string;
      id?: string;
      contentType?: ReasoningContentType;
      signature?: string;
    }
  | { type: "tool_call"; toolCall: ToolCall }
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
      toolCall: ToolCall;
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
      result: string;
      structuredResult?: ToolResultContent[] | undefined;
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
  | {
      type: "final";
      result: AgentResponse<Output> | AgentBlockedResult;
    }
  | AgentApprovalRequiredEvent
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
  steer(input: AgentSteerInput): boolean;
}
