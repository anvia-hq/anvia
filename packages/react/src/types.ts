import type { Message } from "@anvia/core/completion";
import type { CreateUIAttachment, UIMessage, UIStreamEvent, UIStreamRequest } from "@anvia/core/ui";

export type {
  CreateUIAttachment,
  UIAttachment,
  UIError,
  UIMessage,
  UIMessagePart,
  UIMessageRole,
  UIStreamEvent,
  UIStreamRequest,
} from "@anvia/core/ui";

export type EventStreamFormat = "jsonl" | "sse";

export type TransportOptions = {
  signal?: AbortSignal;
  headers?: HeadersInit;
};

export type EventTransport<TRequest, TEvent> = {
  send(request: TRequest, options?: TransportOptions): AsyncIterable<TEvent>;
};

export type ChatResumeCursor = {
  streamId: string;
  after: number;
};

export type ChatResumeStorage = "sessionStorage" | "localStorage" | Storage;

export type ChatResumeOptions = {
  key: string;
  storage?: ChatResumeStorage;
  auto?: boolean;
};

export type ChatResumeState = {
  version: 1;
  streamId: string;
  lastEventId: number;
  messages: UIMessage[];
};

export type ResumableStreamEnvelope<TEvent> =
  | {
      type: "stream_start";
      streamId: string;
      eventId: 0;
    }
  | {
      type: "stream_event";
      streamId: string;
      eventId: number;
      event: TEvent;
    }
  | {
      type: "stream_end";
      streamId: string;
      eventId: number;
      status: "running" | "completed" | "error" | "missing";
    };

export type ToolApprovalStatus = "pending" | "approved" | "rejected" | "timed_out";

export type ToolApproval = {
  id: string;
  runId?: string;
  agentId?: string;
  sessionId?: string;
  toolName: string;
  callId?: string;
  internalCallId?: string;
  args?: string;
  status: ToolApprovalStatus;
  requestedAt?: string;
  resolvedAt?: string;
  reason?: string;
};

export type ToolQuestionStatus = "pending" | "answered";

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
  args?: string;
  questions: ToolQuestionPrompt[];
  status: ToolQuestionStatus;
  requestedAt?: string;
  answeredAt?: string;
  answers?: ToolQuestionAnswer[];
};

export type ToolApprovalDecisionInput = {
  approvalId: string;
  approved: boolean;
  reason?: string;
  approval?: ToolApproval;
};

export type ToolQuestionAnswerInput = {
  questionId: string;
  answers: ToolQuestionAnswer[];
  question?: ToolQuestion;
};

export type HumanInputOptions<TEvent = unknown> = {
  endpoint?: string | URL;
  fetch?: typeof fetch;
  eventToApproval?: (event: TEvent) => ToolApproval | undefined;
  eventToQuestion?: (event: TEvent) => ToolQuestion | undefined;
  decideApproval?: (decision: ToolApprovalDecisionInput) => Promise<ToolApproval | undefined>;
  answerQuestion?: (answer: ToolQuestionAnswerInput) => Promise<ToolQuestion | undefined>;
};

export type HumanInputState = {
  approvals: {
    all: ToolApproval[];
    pending: ToolApproval[];
  };
  questions: {
    all: ToolQuestion[];
    pending: ToolQuestion[];
  };
};

export type ChatSuggestion = {
  id: string;
  prompt: string;
  label?: string;
  metadata?: UIMessage["metadata"];
};

export type SendMessageInput =
  | string
  | UIMessage
  | {
      id?: string;
      text?: string;
      attachments?: CreateUIAttachment[];
      metadata?: UIMessage["metadata"];
    };

export type CreateChatRequestArgs = {
  messages: UIMessage[];
  uiMessages: UIMessage[];
  coreMessages: Message[];
  resume?: ChatResumeCursor | undefined;
};

export type UseChatStatus = "idle" | "streaming" | "error";

export type UseChatOptions<TRequest = UIStreamRequest, TEvent = UIStreamEvent> = {
  transport?: EventTransport<TRequest, TEvent>;
  endpoint?: string | URL;
  format?: EventStreamFormat;
  initialMessages?: UIMessage[];
  resume?: ChatResumeOptions;
  createRequest?: (args: CreateChatRequestArgs) => TRequest;
  eventToUIEvent?: (event: TEvent) => UIStreamEvent | undefined;
  eventToDelta?: (event: TEvent) => string | undefined;
  eventToFinal?: (event: TEvent) => string | undefined;
  humanInput?: HumanInputOptions<TEvent>;
  suggestions?: ChatSuggestion[];
  onEvent?: (event: TEvent) => void;
  onError?: (error: unknown) => void;
};

export type SetMessages = (
  messages: UIMessage[] | ((messages: UIMessage[]) => UIMessage[]),
) => void;

export type UseChatResult<TEvent = UIStreamEvent> = {
  messages: UIMessage[];
  events: TEvent[];
  suggestions?: ChatSuggestion[];
  setMessages: SetMessages;
  sendMessage(input: SendMessageInput): Promise<void>;
  send(input?: string): Promise<void>;
  regenerate(): Promise<void>;
  stop(): void;
  reset(messages?: UIMessage[]): void;
  status: UseChatStatus;
  error: unknown;
  text: string;
  streamId?: string | undefined;
  isResuming: boolean;
  resume(): Promise<void>;
  humanInput: HumanInputState;
  decidingApprovals: ReadonlySet<string>;
  answeringQuestions: ReadonlySet<string>;
  approveTool(approvalId: string, reason?: string): Promise<void>;
  rejectTool(approvalId: string, reason?: string): Promise<void>;
  answerToolQuestion(questionId: string, answers: ToolQuestionAnswer[]): Promise<void>;
};
