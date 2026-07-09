---
title: "React"
description: "Client transports and hooks from @anvia/react."
section: packages
sidebar:
  group: "react"
  order: 6
  label: "React"
---
Import from `@anvia/react`.

## Types

```ts
type EventStreamFormat = "jsonl" | "sse";

type TransportOptions = {
  signal?: AbortSignal;
  headers?: HeadersInit;
};

type UIMessageRole = "system" | "user" | "assistant" | "tool";

type UIError = {
  name?: string;
  message: string;
};

type UIMessage = {
  id: string;
  role: UIMessageRole;
  parts: UIMessagePart[];
  metadata?: unknown;
};

type UIAttachment = {
  id: string;
  type: "image" | "document" | "file";
  name?: string;
  mediaType?: string;
  url?: string;
  data?: string;
  text?: string;
  detail?: "auto" | "low" | "high";
  metadata?: unknown;
};

type CreateUIAttachment = Omit<UIAttachment, "id"> & {
  id?: string;
};

type UIMessagePart =
  | { id: string; type: "text"; text: string }
  | { id: string; type: "reasoning"; text: string; reasoningId?: string }
  | {
      id: string;
      type: "tool";
      toolName: string;
      toolCallId: string;
      callId?: string;
      state: "input-streaming" | "input-available" | "output-available" | "error";
      input?: unknown;
      output?: unknown;
      error?: UIError;
    }
  | { id: string; type: "data"; name: string; data: unknown }
  | { id: string; type: "attachment"; attachment: UIAttachment }
  | { id: string; type: "error"; error: UIError };

type UIStreamRequest = {
  messages: Message[];
  stream: true;
  metadata?: unknown;
};

type UIStreamEvent =
  | { type: "message_start"; message: UIMessage }
  | { type: "text_delta"; messageId: string; partId: string; delta: string }
  | { type: "reasoning_delta"; messageId: string; partId: string; delta: string }
  | {
      type: "tool_update";
      messageId: string;
      partId: string;
      part: Extract<UIMessagePart, { type: "tool" }>;
    }
  | { type: "message_end"; messageId: string; usage?: unknown; metadata?: unknown }
  | { type: "error"; error: UIError };

type SendMessageInput =
  | string
  | UIMessage
  | {
      id?: string;
      text?: string;
      attachments?: CreateUIAttachment[];
      metadata?: UIMessage["metadata"];
    };

type ChatSuggestion = {
  id: string;
  prompt: string;
  label?: string;
  metadata?: UIMessage["metadata"];
};

type CreateChatRequestArgs = {
  messages: UIMessage[];
  uiMessages: UIMessage[];
  coreMessages: Message[];
  resume?: ChatResumeCursor;
};

type UseChatStatus = "idle" | "streaming" | "error";

type ChatResumeCursor = {
  streamId: string;
  after: number;
};

type ChatResumeStorage = "sessionStorage" | "localStorage" | Storage;

type ChatResumeOptions = {
  key: string;
  storage?: ChatResumeStorage;
  auto?: boolean;
};

type ChatResumeState = {
  version: 1;
  streamId: string;
  lastEventId: number;
  messages: UIMessage[];
};

type ResumableStreamEnvelope<TEvent> =
  | { type: "stream_start"; streamId: string; eventId: 0 }
  | { type: "stream_event"; streamId: string; eventId: number; event: TEvent }
  | {
      type: "stream_end";
      streamId: string;
      eventId: number;
      status: "running" | "completed" | "error" | "missing";
    };

type ToolApprovalStatus = "pending" | "approved" | "rejected" | "timed_out";

type ToolApproval = {
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

type ToolQuestionStatus = "pending" | "answered";

type ToolQuestionChoice = {
  label: string;
  value: string;
};

type ToolQuestionPrompt = {
  id: string;
  question: string;
  choices: ToolQuestionChoice[];
};

type ToolQuestionAnswer = {
  questionId: string;
  answer: string;
  choice?: string;
  custom?: boolean;
};

type ToolQuestion = {
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

type ToolApprovalDecisionInput = {
  approvalId: string;
  approved: boolean;
  reason?: string;
  approval?: ToolApproval;
};

type ToolQuestionAnswerInput = {
  questionId: string;
  answers: ToolQuestionAnswer[];
  question?: ToolQuestion;
};

type HumanInputOptions<TEvent = unknown> = {
  endpoint?: string | URL;
  fetch?: typeof fetch;
  eventToApproval?: (event: TEvent) => ToolApproval | undefined;
  eventToQuestion?: (event: TEvent) => ToolQuestion | undefined;
  decideApproval?: (decision: ToolApprovalDecisionInput) => Promise<ToolApproval | undefined>;
  answerQuestion?: (answer: ToolQuestionAnswerInput) => Promise<ToolQuestion | undefined>;
};

type HumanInputState = {
  approvals: { all: ToolApproval[]; pending: ToolApproval[] };
  questions: { all: ToolQuestion[]; pending: ToolQuestion[] };
};

type SetMessages = (
  messages: UIMessage[] | ((messages: UIMessage[]) => UIMessage[]),
) => void;
```


## defaultEventToApproval

```ts
function defaultEventToApproval<TEvent>(event: TEvent): ToolApproval | undefined;
```

Purpose: map Studio `tool_approval_request` and `tool_approval_result` stream events into tracked `ToolApproval` records for `useChat` human-input state.

## defaultEventToQuestion

```ts
function defaultEventToQuestion<TEvent>(event: TEvent): ToolQuestion | undefined;
```

Purpose: map Studio `tool_question_request` and `tool_question_result` stream events into tracked `ToolQuestion` records for `useChat` human-input state.

## defaultDecideApproval

```ts
function defaultDecideApproval(
  input: ToolApprovalDecisionInput,
  options: { endpoint?: string | URL; fetch?: typeof fetch },
): Promise<ToolApproval | undefined>;
```

Purpose: submit a tool approval decision to the default human-input endpoint path, `approvals/:approvalId/decision`, and return an updated approval when the response contains JSON.

## defaultAnswerQuestion

```ts
function defaultAnswerQuestion(
  input: ToolQuestionAnswerInput,
  options: { endpoint?: string | URL; fetch?: typeof fetch },
): Promise<ToolQuestion | undefined>;
```

Purpose: submit tool-question answers to the default human-input endpoint path, `questions/:questionId/answer`, and return an updated question when the response contains JSON.

## EventTransport

```ts
type EventTransport<TRequest, TEvent> = {
  send(request: TRequest, options?: TransportOptions): AsyncIterable<TEvent>;
};
```

Purpose: common boundary for JSONL, SSE, WebSocket, local, and custom transports.

## readJsonlStream

```ts
function readJsonlStream<TEvent>(stream: ReadableStream<Uint8Array>): AsyncIterable<TEvent>;
```

Purpose: parse newline-delimited JSON from a web stream.

## readSseStream

```ts
function readSseStream<TEvent>(stream: ReadableStream<Uint8Array>): AsyncIterable<TEvent>;
```

Purpose: parse Server-Sent Events whose `data:` payload is JSON.

## fetchEventStream

```ts
type FetchEventStreamOptions = RequestInit & {
  format?: "jsonl" | "sse";
  fetch?: typeof fetch;
};

function fetchEventStream<TEvent>(
  input: string | URL | Request,
  options?: FetchEventStreamOptions,
): AsyncIterable<TEvent>;
```

Purpose: fetch and parse a streaming response as an async iterable.

## createFetchTransport

```ts
type CreateFetchTransportOptions<TRequest, TEvent> = {
  endpoint: string | URL | ((request: TRequest) => string | URL);
  method?: string;
  format?: "jsonl" | "sse";
  fetch?: typeof fetch;
  headers?: HeadersInit | ((request: TRequest) => HeadersInit | Promise<HeadersInit>);
  body?: (request: TRequest) => BodyInit | null | undefined | Promise<BodyInit | null | undefined>;
  init?: Omit<RequestInit, "body" | "headers" | "method" | "signal">;
  mapEvent?: (event: unknown) => TEvent;
};

function createFetchTransport<TRequest, TEvent>(
  options: CreateFetchTransportOptions<TRequest, TEvent>,
): EventTransport<TRequest, TEvent>;
```

Purpose: create a POST JSON transport by default while allowing custom headers, bodies, endpoints, init options, and event mapping. `GET` and `HEAD` transports do not add an implicit JSON body or `content-type`; pass `body` explicitly if a custom transport needs one.

## createChatTransport

```ts
function createChatTransport<TRequest, TEvent>(
  options: CreateFetchTransportOptions<TRequest, TEvent>,
): EventTransport<TRequest, TEvent>;
```

Purpose: named chat transport helper built on the fetch transport.

## initialMessagesFromMemory

```ts
function initialMessagesFromMemory(messages: Message[]): UIMessage[];
```

Purpose: convert stored Anvia memory messages into the `UIMessage[]` shape accepted by
`useChat({ initialMessages })`.

The helper adapts core message data for React state. It does not depend on a specific database
schema.

## useChat

```ts
type UseChatOptions<TRequest = UIStreamRequest, TEvent = UIStreamEvent> = {
  transport?: EventTransport<TRequest, TEvent>;
  endpoint?: string | URL;
  format?: "jsonl" | "sse";
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

type UseChatResult<TEvent = UIStreamEvent> = {
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
  streamId?: string;
  isResuming: boolean;
  resume(): Promise<void>;
  humanInput: HumanInputState;
  decidingApprovals: Set<string>;
  answeringQuestions: Set<string>;
  approveTool(approvalId: string, reason?: string): Promise<void>;
  rejectTool(approvalId: string, reason?: string): Promise<void>;
  answerToolQuestion(questionId: string, answers: ToolQuestionAnswer[]): Promise<void>;
};

function useChat<TRequest = UIStreamRequest, TEvent = UIStreamEvent>(options?: {
  transport?: EventTransport<TRequest, TEvent>;
  endpoint?: string | URL;
  format?: "jsonl" | "sse";
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
}): UseChatResult<TEvent>;
```

Purpose: React chat state machine that sends `UIStreamRequest` by default and accumulates response events into `UIMessage[]`.

Passing `endpoint` creates a default JSONL fetch transport. Passing `transport` makes the hook independent of HTTP. `sendMessage(...)` appends a user message, keeps the full UI message history in state, and sends the converted core message history. Custom request factories receive the UI array as `messages` for compatibility and the converted array as `coreMessages`. The hook applies raw `CompletionStreamEvent`, raw `AgentStreamEvent`, or `UIStreamEvent` records as the assistant response arrives.

Passing `humanInput` tracks streamed tool approval and question events in `humanInput.approvals` and `humanInput.questions`. The action helpers submit approval decisions and question answers through custom handlers or the default `/approvals/:id/decision` and `/questions/:id/answer` endpoint paths.

Passing `resume: { key }` stores the active `streamId`, last event cursor, and current messages in
`sessionStorage` by default. On mount, `useChat` sends the same endpoint a POST body with
`resume: { streamId, after }`, unwraps `ResumableStreamEnvelope` records, replays missed events, and
continues tailing live events until `stream_end`. Custom `createRequest` callbacks receive
`args.resume` and should forward it when using resumable server routes.

## useCompletion

```ts
type UseCompletionStatus = "idle" | "streaming" | "error";

type UseCompletionRequestArgs = {
  messages: UIMessage[];
  uiMessages: UIMessage[];
  coreMessages: Message[];
};

type UseCompletionOptions<TRequest = UIStreamRequest, TEvent = UIStreamEvent> = {
  transport?: EventTransport<TRequest, TEvent>;
  endpoint?: string | URL;
  format?: "jsonl" | "sse";
  initialMessages?: UIMessage[];
  initialCompletion?: string;
  createRequest?: (args: UseCompletionRequestArgs) => TRequest;
  eventToUIEvent?: (event: TEvent) => UIStreamEvent | undefined;
  eventToDelta?: (event: TEvent) => string | undefined;
  eventToFinal?: (event: TEvent) => string | undefined;
  onEvent?: (event: TEvent) => void;
  onError?: (error: unknown) => void;
};

type UseCompletionResult<TEvent = UIStreamEvent> = {
  messages: UIMessage[];
  completion: string;
  input: string;
  setInput(input: string): void;
  complete(prompt?: string): Promise<void>;
  stop(): void;
  reset(messagesOrCompletion?: UIMessage[] | string): void;
  status: UseCompletionStatus;
  error: unknown;
  events: TEvent[];
};

function useCompletion<TRequest = UIStreamRequest, TEvent = UIStreamEvent>(
  options?: UseCompletionOptions<TRequest, TEvent>,
): UseCompletionResult<TEvent>;
```

Purpose: React hook for text completion streaming that also exposes the underlying assistant `messages`.

By default, `complete(prompt)` appends one user `UIMessage` to the current messages, converts the full UI history to core messages, sends `{ messages, stream: true }`, and consumes raw `CompletionStreamEvent`, raw `AgentStreamEvent`, or `UIStreamEvent` records. Custom request factories receive the UI array as `messages` for compatibility and the converted array as `coreMessages`. `completion` is a convenience string derived from the latest assistant text parts.

## createDirectTransport

```ts
function createDirectTransport<TRequest, TEvent>(
  handler: (request: TRequest) => AsyncIterable<TEvent>,
): EventTransport<TRequest, TEvent>;
```

Purpose: in-process transport that calls a handler function directly, bypassing HTTP. Works with both `useChat` and `useCompletion`. Useful for SSR, testing, and single-process applications.

## EventStreamHttpError

```ts
class EventStreamHttpError extends Error {
  readonly response: Response;
  readonly body: string;
}
```

Purpose: thrown by `fetchEventStream(...)` when the HTTP response is not ok.

For workflow guidance, see [Client Transports](/docs/basics/react-client).
