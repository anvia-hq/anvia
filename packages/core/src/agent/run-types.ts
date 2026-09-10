import type {
  CompletionControlValues,
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
  CompletionModelControls,
} from "../completion/index";
import type { GuardrailDecisionRecord, GuardrailPolicyInput } from "../guardrails";
import type { MemoryCompactionInfo, MemoryScope } from "../memory";
import type {
  AgentGenerationModelInfo,
  AgentRunPromptRef,
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

/** A run prompt: plain text or a full user message. */
export type AgentPrompt = string | UserMessage;

/**
 * What a run starts from — exactly one of:
 *
 * - `prompt`: a new run from a prompt
 * - `messages`: a new run from a full message history
 * - `continuation` + `response`: resumption of a run suspended on a human
 *   interaction, delivering the human's answer
 */
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

/** Mid-run input that is queued and applied at the next turn boundary. */
export type AgentSteerInput =
  | { prompt: AgentPrompt; messages?: never }
  | { messages: readonly UserMessage[]; prompt?: never };

/**
 * Per-run overrides applied on top of the agent's constructor settings.
 */
export type AgentRunSettings<
  Output = string,
  RawResponse = unknown,
  Controls extends CompletionModelControls = CompletionModelControls,
> = {
  /** Maximum tool-loop turns for this run; overrides the agent's `defaultMaxTurns`. */
  maxTurns?: number | undefined;
  retries?: RetrySetting | undefined;
  abortSignal?: AbortSignal | undefined;
  lifecycle?: AgentLifecycle<Output, RawResponse> | undefined;
  guardrails?: GuardrailPolicyInput | undefined;
  toolConcurrency?: number | undefined;
  middlewares?: readonly AgentMiddleware[] | undefined;
  trace?: AgentTraceOptions | undefined;
  controls?: CompletionControlValues<Controls> | undefined;
};

/** Input and settings for one agent run. */
export type AgentRunOptions<
  Output = string,
  RawResponse = unknown,
  Controls extends CompletionModelControls = CompletionModelControls,
> = AgentInput & AgentRunSettings<Output, RawResponse, Controls>;

/** Options for triggering memory compaction on a session. */
export type AgentMemoryCompactionOptions = {
  session: MemoryScope;
  abortSignal?: AbortSignal | undefined;
};

/** Links a resumed run to the suspended run it continues. */
export type AgentRunLink = Readonly<{
  runId: string;
  interactionId: string;
}>;

/** Fields shared by every terminal run outcome. */
export type AgentOutcomeBase = {
  runId: string;
  /** The final assistant text of the run. */
  text: string;
  usage: Usage;
  finishReason?: CompletionFinishReason | undefined;
  providerFinishReason?: string | undefined;
  contextUsage?: ContextUsage | undefined;
  /** The full message history produced by the run, ready to replay. */
  messages: MessageType[];
  trace?: AgentTraceInfo | undefined;
  guardrails?: GuardrailDecisionRecord[] | undefined;
  sources?: CompletionSource[] | undefined;
  providerToolCalls?: ProviderToolCall[] | undefined;
  memoryCompaction?: MemoryCompactionInfo | undefined;
  /** Set when this run resumed a prior run suspended on an interaction. */
  resumedFrom?: AgentRunLink | undefined;
};

/** The run finished and produced an output. */
export type AgentResponse<Output = string> = AgentOutcomeBase & {
  type: "response";
  output: Output;
};

/**
 * The run was stopped by a guardrail. `stage` reports whether the input prompt
 * or the generated output was rejected.
 */
export type AgentBlockedOutcome = AgentOutcomeBase & {
  type: "blocked";
  stage: "input" | "output";
  reason: string;
  message?: string | undefined;
};

/**
 * The run suspended to wait for a human interaction (approval or question).
 * Resume it by passing the returned `continuation` together with an
 * {@link AgentInteractionResponse} as the next run's input.
 */
export type AgentInteractionOutcome = AgentOutcomeBase & {
  type: "interaction";
  interaction: AgentInteractionRequest;
  continuation: AgentContinuation;
};

/**
 * Terminal result of a run: a response, a guardrail block, or a suspension on
 * a human interaction.
 */
export type AgentOutcome<Output = string> =
  | AgentResponse<Output>
  | AgentBlockedOutcome
  | AgentInteractionOutcome;

/** Run-level content deltas, not tagged with a turn. */
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

/** Terminal error event carrying the usage accumulated before the failure. */
export type AgentErrorStreamEvent = {
  type: "error";
  error: unknown;
  usage: Usage;
};

/** Partial tool-call input arriving mid-generation within one turn. */
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

/** Emitted when the run compacts session memory mid-run. */
export type AgentMemoryCompactionEvent = MemoryCompactionInfo & {
  type: "memory_compaction";
};

/** Emitted when a sibling run in the same session answers a tool interaction. */
export type AgentInteractionResponseEvent = {
  type: "interaction_response";
  response: ToolInteractionResponsePart;
  sourceRunId: string;
};

/** Acknowledgement that steering input was accepted and queued. */
export type AgentSteerReceipt = Readonly<{
  id: string;
  status: "queued";
}>;

/** Confirms a queued steer input was applied, at the turn it landed in. */
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
      promptRef?: AgentRunPromptRef | undefined;
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
  | AgentOutcome<Output>
  | AgentErrorStreamEvent;

/**
 * Events of a single agent run, each tagged with the turn that produced it.
 * The stream always ends with an {@link AgentOutcome} or an
 * {@link AgentErrorStreamEvent}.
 */
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

/** An event from a child agent run surfaced inside a parent run's stream. */
export type AgentStreamEvent<Output = string, RawResponse = unknown> =
  | AgentChildStreamEvent<Output, RawResponse>
  | AgentToolStreamEvent;

/**
 * Async stream of run events. The run is driven by consuming the stream —
 * iterating events or awaiting `text`/`result`. The stream can be consumed
 * once; abandoning it before completion cancels the run.
 */
export interface AgentStream<Output = string, RawResponse = unknown> extends AsyncIterable<
  AgentStreamEvent<Output, RawResponse>
> {
  readonly events: AsyncIterable<AgentStreamEvent<Output, RawResponse>>;
  /** Incremental text deltas only, with turn metadata stripped. */
  readonly textStream: AsyncIterable<string>;
  /** Resolves with the run's final assistant text; rejects if the run errors. */
  readonly text: Promise<string>;
  /** Resolves with the run's terminal outcome; rejects if the run errors. */
  readonly result: Promise<AgentOutcome<Output>>;
  /** Queues input to inject at the next turn boundary. Throws if the run already ended. */
  steer(input: AgentSteerInput): AgentSteerReceipt;
  /** Cancels the run; in-flight tool calls and generation are aborted. */
  cancel(reason?: string): void;
}
