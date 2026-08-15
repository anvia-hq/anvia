import type {
  ClientDataMap,
  ClientDataSchemas,
  ClientStreamCursor,
  ClientStreamEvent,
  ClientStreamRequest,
  ClientTransport,
  CreateUIAttachment,
  ToolApproval,
  ToolQuestion,
  ToolQuestionAnswer,
  UIMessage,
} from "@anvia/client";
import type { ContextUsage, Message } from "@anvia/core/completion";

export type ClientConnectionOptions<TRequest, TData extends ClientDataMap> =
  | {
      endpoint: string | URL | ((request: TRequest) => string | URL);
      transport?: never;
      format?: "auto" | "jsonl" | "sse";
      fetch?: typeof fetch;
      headers?: HeadersInit | ((request: TRequest) => HeadersInit | Promise<HeadersInit>);
      body?: (
        request: TRequest,
      ) => BodyInit | null | undefined | Promise<BodyInit | null | undefined>;
      dataSchemas?: ClientDataSchemas<TData>;
    }
  | {
      transport: ClientTransport<TRequest, TData>;
      endpoint?: never;
      format?: never;
      fetch?: never;
      headers?: never;
      body?: never;
      dataSchemas?: never;
    };

export type ChatResumeCursor = ClientStreamCursor;
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

export type HumanInputOptions = {
  endpoint?: string | URL;
  fetch?: typeof fetch;
  decideApproval?: (decision: ToolApprovalDecisionInput) => Promise<ToolApproval | undefined>;
  answerQuestion?: (answer: ToolQuestionAnswerInput) => Promise<ToolQuestion | undefined>;
};

export type HumanInputState = {
  approvals: { all: ToolApproval[]; pending: ToolApproval[] };
  questions: { all: ToolQuestion[]; pending: ToolQuestion[] };
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
  uiMessages: UIMessage[];
  messages: Message[];
  resume?: ChatResumeCursor;
};

export type UseChatStatus = "ready" | "submitted" | "streaming" | "error";

type UseChatCommonOptions<TData extends ClientDataMap> = {
  initialMessages?: UIMessage[];
  resume?: ChatResumeOptions;
  humanInput?: HumanInputOptions;
  suggestions?: ChatSuggestion[];
  onEvent?: (event: ClientStreamEvent<TData>) => void;
  onError?: (error: Error) => void;
};

type ChatRequestFactoryOptions<TRequest> = [ClientStreamRequest] extends [TRequest]
  ? { createRequest?: (args: CreateChatRequestArgs) => TRequest }
  : { createRequest: (args: CreateChatRequestArgs) => TRequest };

export type UseChatOptions<
  TRequest = ClientStreamRequest,
  TData extends ClientDataMap = ClientDataMap,
> = ClientConnectionOptions<TRequest, TData> &
  UseChatCommonOptions<TData> &
  ChatRequestFactoryOptions<TRequest>;

export type SetMessages = (
  messages: UIMessage[] | ((messages: UIMessage[]) => UIMessage[]),
) => void;

export type UseChatResult<TData extends ClientDataMap = ClientDataMap> = {
  messages: UIMessage[];
  events: ClientStreamEvent<TData>[];
  contextUsage: ContextUsage | undefined;
  suggestions: ChatSuggestion[];
  setMessages: SetMessages;
  sendMessage(input: SendMessageInput): Promise<void>;
  send(input?: string): Promise<void>;
  regenerate(): Promise<void>;
  stop(): void;
  reset(messages?: UIMessage[]): void;
  status: UseChatStatus;
  error: Error | undefined;
  text: string;
  streamId: string | undefined;
  isResuming: boolean;
  resume(): Promise<void>;
  humanInput: HumanInputState;
  decidingApprovals: ReadonlySet<string>;
  answeringQuestions: ReadonlySet<string>;
  approveTool(approvalId: string, reason?: string): Promise<void>;
  rejectTool(approvalId: string, reason?: string): Promise<void>;
  answerToolQuestion(questionId: string, answers: ToolQuestionAnswer[]): Promise<void>;
};
