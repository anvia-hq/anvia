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
} from "../completion/index";
import type { GuardrailDecisionRecord, GuardrailPolicyInput } from "../guardrails";
import type {
  AgentGenerationModelInfo,
  AgentTraceInfo,
  AgentTraceOptions,
} from "../observability/types";
import type { RetryOptions } from "../retry";
import type { AgentMiddleware, ToolApprovalRequest } from "../tool";
import type { AgentLifecycle } from "./lifecycle";

export type AgentInput = string | MessageType | MessageType[];

export type AgentRunOptions = {
  maxTurns?: number | undefined;
  retries?: RetryOptions | undefined;
  lifecycle?: AgentLifecycle | undefined;
  guardrails?: GuardrailPolicyInput | undefined;
  toolConcurrency?: number | undefined;
  middlewares?: AgentMiddleware[] | undefined;
  trace?: AgentTraceOptions | undefined;
};

export type AgentResponse = {
  status: "completed";
  runId: string;
  output: string;
  usage: Usage;
  contextUsage?: ContextUsage | undefined;
  messages: MessageType[];
  trace?: AgentTraceInfo | undefined;
  guardrails?: GuardrailDecisionRecord[] | undefined;
  sources?: CompletionSource[] | undefined;
  providerToolCalls?: ProviderToolCall[] | undefined;
};

export type AgentApprovalRequiredResult = {
  status: "approval_required";
  runId: string;
  approval: AgentToolApprovalRequest;
  usage: Usage;
  messages: MessageType[];
};

export type AgentResult = AgentResponse | AgentApprovalRequiredResult;

export type AgentToolApprovalRequest = Pick<
  ToolApprovalRequest,
  "id" | "toolName" | "toolCallId" | "reason"
> & {
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

export type AgentStreamOptions = AgentRunOptions & {
  /** @default true */
  includeToolCallDeltas?: boolean;
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

type AgentChildStreamEventBase<RawResponse = unknown> =
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
      toolCallId?: string;
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
  | {
      type: "final";
      runId: string;
      output: string;
      usage: Usage;
      contextUsage?: ContextUsage | undefined;
      messages: MessageType[];
      trace?: AgentTraceInfo | undefined;
      guardrails?: GuardrailDecisionRecord[] | undefined;
      sources?: CompletionSource[] | undefined;
      providerToolCalls?: ProviderToolCall[] | undefined;
    }
  | AgentApprovalRequiredEvent
  | AgentErrorStreamEvent;

export type AgentChildStreamEventWithoutToolCallDeltas<RawResponse = unknown> =
  AgentChildStreamEventBase<RawResponse>;

export type AgentChildStreamEvent<RawResponse = unknown> =
  | AgentChildStreamEventBase<RawResponse>
  | AgentToolCallDeltaEvent;

export type AgentChildStreamEventWithToolCallDeltas<RawResponse = unknown> =
  AgentChildStreamEvent<RawResponse>;

type AgentToolStreamEvent<ChildEvent> = {
  type: "agent_tool_event";
  turn: number;
  toolName: string;
  toolCallId?: string;
  internalCallId: string;
  agentId: string;
  agentName?: string;
  event: ChildEvent;
};

export type AgentStreamEventWithoutToolCallDeltas<RawResponse = unknown> =
  | AgentChildStreamEventWithoutToolCallDeltas<RawResponse>
  | AgentToolStreamEvent<AgentChildStreamEventWithoutToolCallDeltas<RawResponse>>;

export type AgentStreamEvent<RawResponse = unknown> =
  | AgentChildStreamEvent<RawResponse>
  | AgentToolStreamEvent<AgentChildStreamEvent<RawResponse>>;

export type AgentStreamEventWithToolCallDeltas<RawResponse = unknown> =
  AgentStreamEvent<RawResponse>;

export interface AgentStream<Event = AgentStreamEvent> extends AsyncIterable<Event> {
  steer(input: AgentInput): boolean;
}
