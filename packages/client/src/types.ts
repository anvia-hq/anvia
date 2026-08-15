import type {
  CompletionSource,
  ContextUsage,
  ImageDetail,
  JsonValue,
  Message,
  ProviderToolCall,
  ReasoningContent,
  ReasoningContentType,
  ToolResultContent,
  Usage,
} from "@anvia/core/completion";
import type { GuardrailDecisionRecord } from "@anvia/core/guardrails";
import type { MemoryCompactionInfo } from "@anvia/core/memory";

export const CLIENT_STREAM_PROTOCOL = "anvia.client.v1" as const;

export type ClientDataMap = Record<string, JsonValue>;

export type ClientDataSchema<T extends JsonValue = JsonValue> = {
  safeParse(value: unknown): { success: true; data: T } | { success: false; error?: unknown };
};

export type ClientDataSchemas<TData extends ClientDataMap> = {
  [Name in keyof TData]: ClientDataSchema<TData[Name]>;
};

export type UIMessageRole = "system" | "user" | "assistant" | "tool";

export type ClientStreamError = {
  name?: string;
  message: string;
  code?: string;
  retryable?: boolean;
  details?: JsonValue;
};

export type UIError = ClientStreamError;

export type UIMessageGeneration = {
  runId?: string;
  status?: "completed" | "blocked" | "approval_required" | "cancelled" | "error";
  usage?: Usage;
  contextUsage?: ContextUsage;
  trace?: { traceId?: string; observationId?: string };
  memoryCompaction?: MemoryCompactionInfo;
};

export type UIMessage = {
  id: string;
  role: UIMessageRole;
  parts: UIMessagePart[];
  modelMessageId?: string;
  metadata?: JsonValue;
  generation?: UIMessageGeneration;
};

export type UIAttachment = {
  id: string;
  type: "image" | "document" | "file";
  name?: string;
  mediaType?: string;
  url?: string;
  data?: string;
  text?: string;
  detail?: ImageDetail;
  metadata?: JsonValue;
};

export type CreateUIAttachment = Omit<UIAttachment, "id"> & {
  id?: string;
};

export type UIMessagePart =
  | {
      id: string;
      type: "text";
      text: string;
      signature?: string;
    }
  | {
      id: string;
      type: "reasoning";
      text: string;
      reasoningId?: string;
      content?: ReasoningContent[];
    }
  | {
      id: string;
      type: "tool";
      toolName: string;
      toolCallId: string;
      callId?: string;
      internalCallId?: string;
      turn?: number;
      state: "input-streaming" | "input-available" | "output-available" | "error";
      input?: JsonValue;
      output?: JsonValue;
      resultContent?: ToolResultContent[];
      signature?: string;
      additionalParams?: JsonValue;
      error?: UIError;
    }
  | {
      id: string;
      type: "source";
      source: CompletionSource;
    }
  | {
      id: string;
      type: "data";
      name: string;
      data: JsonValue;
    }
  | {
      id: string;
      type: "attachment";
      attachment: UIAttachment;
    }
  | {
      id: string;
      type: "error";
      error: UIError;
    };

export type UIToolMessagePart = Extract<UIMessagePart, { type: "tool" }>;

export type ClientStreamCursor = {
  streamId: string;
  after: number;
};

export type ClientStreamRequest = {
  messages: Message[];
  metadata?: JsonValue;
  resume?: ClientStreamCursor;
};

export type ClientStreamScope = {
  agentId?: string;
  agentName?: string;
  parentRunId?: string;
  parentToolName?: string;
  parentToolCallId?: string;
  parentInternalToolCallId?: string;
};

export type ClientToolApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "timed_out"
  | "cancelled";

export type ToolApproval = {
  id: string;
  runId?: string;
  agentId?: string;
  sessionId?: string;
  toolName: string;
  callId?: string;
  internalCallId?: string;
  input?: JsonValue;
  status: ClientToolApprovalStatus;
  requestedAt?: string;
  resolvedAt?: string;
  reason?: string;
};

export type ToolQuestionStatus = "pending" | "answered" | "cancelled";

export type ToolQuestionChoice = {
  label: string;
  value: string;
};

export type ToolQuestionPrompt = {
  id: string;
  question: string;
  choices: ToolQuestionChoice[];
};

export type ToolQuestionAnswer = {
  questionId: string;
  answer: string;
  choice?: string;
  custom?: boolean;
};

export type ToolQuestion = {
  id: string;
  runId?: string;
  agentId?: string;
  sessionId?: string;
  toolName: string;
  callId?: string;
  internalCallId?: string;
  input?: JsonValue;
  questions: ToolQuestionPrompt[];
  status: ToolQuestionStatus;
  requestedAt?: string;
  answeredAt?: string;
  cancelledAt?: string;
  answers?: ToolQuestionAnswer[];
};

type ClientStreamEventBase = {
  runId: string;
  turn?: number;
  scope?: ClientStreamScope;
};

type ClientDataEvent<TData extends ClientDataMap> = {
  [Name in keyof TData & string]: {
    type: "data";
    name: Name;
    data: TData[Name];
    transient?: boolean;
  };
}[keyof TData & string];

type ClientStandardStreamEvent =
  | {
      type: "run_start";
      source: "completion" | "agent";
      metadata?: JsonValue;
    }
  | { type: "turn_start" }
  | {
      type: "generation_start";
      model?: { provider: string; id: string };
    }
  | {
      type: "message_start";
      messageId: string;
      role: "assistant";
      metadata?: JsonValue;
    }
  | {
      type: "text_start";
      messageId: string;
      partId: string;
    }
  | {
      type: "text_delta";
      messageId: string;
      partId: string;
      delta: string;
    }
  | {
      type: "text_end";
      messageId: string;
      partId: string;
      text?: string;
      signature?: string;
    }
  | {
      type: "reasoning_start";
      messageId: string;
      partId: string;
      reasoningId?: string;
    }
  | {
      type: "reasoning_delta";
      messageId: string;
      partId: string;
      delta: string;
      contentType?: ReasoningContentType;
      signature?: string;
    }
  | {
      type: "reasoning_end";
      messageId: string;
      partId: string;
      text?: string;
      content?: ReasoningContent[];
    }
  | {
      type: "tool_call_start";
      messageId: string;
      partId: string;
      toolCallId: string;
      callId?: string;
      toolName?: string;
    }
  | {
      type: "tool_call_delta";
      messageId: string;
      partId: string;
      toolCallId: string;
      callId?: string;
      toolName?: string;
      delta: string;
      mode: "append" | "replace";
      signature?: string;
    }
  | {
      type: "tool_call_end";
      messageId: string;
      partId: string;
      toolCallId: string;
      callId?: string;
      toolName: string;
      input: JsonValue;
      signature?: string;
      additionalParams?: JsonValue;
    }
  | {
      type: "tool_result";
      messageId: string;
      partId: string;
      toolCallId: string;
      callId?: string;
      internalCallId?: string;
      toolName: string;
      input?: JsonValue;
      result:
        | { status: "success"; output: JsonValue; content?: ToolResultContent[] }
        | { status: "error"; error: ClientStreamError };
    }
  | { type: "source"; messageId: string; partId: string; source: CompletionSource }
  | {
      type: "attachment";
      messageId: string;
      partId: string;
      attachment: UIAttachment;
    }
  | { type: "provider_tool_call"; toolCall: ProviderToolCall }
  | { type: "tool_approval"; approval: ToolApproval }
  | { type: "tool_question"; question: ToolQuestion }
  | { type: "guardrail_decision"; decision: GuardrailDecisionRecord }
  | ({ type: "memory_compaction" } & MemoryCompactionInfo)
  | {
      type: "message_end";
      messageId: string;
      modelMessageId?: string;
      /** Authoritative model-authored parts after provider normalization and guardrails. */
      parts?: UIMessagePart[];
      usage?: Usage;
      contextUsage?: ContextUsage;
      metadata?: JsonValue;
    }
  | {
      type: "turn_end";
      usage?: Usage;
      contextUsage?: ContextUsage;
      firstDeltaMs?: number;
    }
  | {
      type: "run_end";
      status: "completed" | "blocked" | "approval_required" | "cancelled" | "error";
      text?: string;
      output?: JsonValue;
      usage?: Usage;
      contextUsage?: ContextUsage;
      trace?: { traceId?: string; observationId?: string };
      memoryCompaction?: MemoryCompactionInfo;
      metadata?: JsonValue;
    }
  | { type: "error"; error: ClientStreamError; usage?: Usage };

export type ClientStreamEvent<TData extends ClientDataMap = ClientDataMap> = ClientStreamEventBase &
  (ClientStandardStreamEvent | ClientDataEvent<TData>);

export type ClientStream<TData extends ClientDataMap = ClientDataMap> = AsyncIterable<
  ClientStreamEvent<TData>
>;

export type ClientStreamFrame<TData extends ClientDataMap = ClientDataMap> =
  | {
      type: "stream_start";
      protocol: typeof CLIENT_STREAM_PROTOCOL;
      streamId: string;
      eventId: 0;
      resumable: boolean;
    }
  | {
      type: "stream_event";
      streamId: string;
      eventId: number;
      event: ClientStreamEvent<TData>;
    }
  | {
      type: "stream_end";
      streamId: string;
      eventId: number;
      status: "completed" | "error" | "missing";
    };

export type ClientTransportOptions = {
  signal?: AbortSignal;
  headers?: HeadersInit;
  resume?: ClientStreamCursor;
};

export type ClientTransport<
  TRequest = ClientStreamRequest,
  TData extends ClientDataMap = ClientDataMap,
> = {
  send: (
    request: TRequest,
    options?: ClientTransportOptions,
  ) => AsyncIterable<ClientStreamFrame<TData>>;
};

export type ClientErrorMapper = (error: unknown) => ClientStreamError;

export type ClientOutputMapper = (output: unknown) => JsonValue | undefined;
