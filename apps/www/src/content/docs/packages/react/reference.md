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
      text: string;
      metadata?: UIMessage["metadata"];
    };

type CreateChatRequestArgs = {
  messages: UIMessage[];
  uiMessages: UIMessage[];
  coreMessages: Message[];
};

type UseChatStatus = "idle" | "streaming" | "error";

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

## useChat

```ts
type UseChatOptions<TRequest = UIStreamRequest, TEvent = UIStreamEvent> = {
  transport?: EventTransport<TRequest, TEvent>;
  endpoint?: string | URL;
  format?: "jsonl" | "sse";
  initialMessages?: UIMessage[];
  createRequest?: (args: CreateChatRequestArgs) => TRequest;
  eventToUIEvent?: (event: TEvent) => UIStreamEvent | undefined;
  eventToDelta?: (event: TEvent) => string | undefined;
  eventToFinal?: (event: TEvent) => string | undefined;
  humanInput?: HumanInputOptions<TEvent>;
  onEvent?: (event: TEvent) => void;
  onError?: (error: unknown) => void;
};

type UseChatResult<TEvent = UIStreamEvent> = {
  messages: UIMessage[];
  events: TEvent[];
  setMessages: SetMessages;
  sendMessage(input: SendMessageInput): Promise<void>;
  send(input?: string): Promise<void>;
  regenerate(): Promise<void>;
  stop(): void;
  reset(messages?: UIMessage[]): void;
  status: UseChatStatus;
  error: unknown;
  text: string;
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
  createRequest?: (args: CreateChatRequestArgs) => TRequest;
  eventToUIEvent?: (event: TEvent) => UIStreamEvent | undefined;
  eventToDelta?: (event: TEvent) => string | undefined;
  eventToFinal?: (event: TEvent) => string | undefined;
  humanInput?: HumanInputOptions<TEvent>;
  onEvent?: (event: TEvent) => void;
  onError?: (error: unknown) => void;
}): UseChatResult<TEvent>;
```

Purpose: React chat state machine that sends `UIStreamRequest` by default and accumulates response events into `UIMessage[]`.

Passing `endpoint` creates a default JSONL fetch transport. Passing `transport` makes the hook independent of HTTP. `sendMessage(...)` appends a user message, keeps the full UI message history in state, and sends the converted core message history. Custom request factories receive the UI array as `messages` for compatibility and the converted array as `coreMessages`. The hook applies raw `CompletionStreamEvent`, raw `AgentStreamEvent`, or `UIStreamEvent` records as the assistant response arrives.

Passing `humanInput` tracks streamed tool approval and question events in `humanInput.approvals` and `humanInput.questions`. The action helpers submit approval decisions and question answers through custom handlers or the default `/approvals/:id/decision` and `/questions/:id/answer` endpoint paths.

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
