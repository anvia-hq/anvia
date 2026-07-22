---
title: "Request"
description: "Prompt requests, prompt responses, agent stream events, and prompt-run errors."
section: packages
sidebar:
  group: "Reference"
  order: 4
  label: "Request"
---
Import from `@anvia/core/request` when a reusable package needs prompt-run contracts without importing agent construction or tool APIs. Application code can also import these symbols from `@anvia/core`.

## PromptRequest

```ts
class PromptRequest<M extends CompletionModel = CompletionModel> {
  maxTurns(maxTurns: number): this;
  withCompletionRetries(options?: CompletionRetryOptions): this;
  withHook(hook: PromptHook): this;
  /** @deprecated Use withHook instead. */
  requestHook(hook: PromptHook): this;
  withToolConcurrency(concurrency: number): this;
  withMiddleware(middleware: AgentMiddleware): this;
  withMiddlewares(middlewares: AgentMiddleware[]): this;
  /** @deprecated Use withMiddleware instead. */
  withToolMiddleware(middleware: ToolMiddleware): this;
  /** @deprecated Use withMiddlewares instead. */
  withToolMiddlewares(middlewares: ToolMiddleware[]): this;
  withTrace(trace: AgentTraceOptions): this;
  approvals(options: ToolApprovalsOptions): this;
  send(): Promise<PromptResponse>;
  stream(): AsyncIterable<AgentStreamEvent>;
  stream(options: { includeToolCallDeltas: false }): AsyncIterable<AgentStreamEventWithoutToolCallDeltas>;
  readableStream(options?: AgentStreamOptions): ReadableStream<Uint8Array>;
}
```

Purpose: per-run request state returned by `agent.prompt(...)` or `agent.session(...).prompt(...)`.

Return behavior: `send()` resolves a final response; `stream()` yields agent run events and ends with a `final` event; `readableStream()` wraps the async iterable in a web stream.

`withCompletionRetries(...)` retries only a failed model invocation within the current turn. It does not restart the run, consume another turn, replay completed tools, or re-run request middleware and hooks. Streaming calls are retried only when the provider fails before yielding any non-error event.

## CompletionRetryOptions

```ts
type CompletionRetryOptions = {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  shouldRetry?: (context: CompletionRetryContext) => boolean;
};
```

Purpose: opt-in, request-scoped retry policy for model calls made by `send()`, `stream()`, and `readableStream()`.

Defaults: three total attempts, a 100 ms initial delay, a 1,000 ms maximum delay, factor-two exponential backoff with full jitter, and conservative transient-error classification. The built-in classifier retries status codes 408, 409, 425, 429, and 5xx responses plus common timeout and connection errors. Abort, authentication, permission, invalid-request, and unrecognized errors are not retried.

`maxAttempts` includes the initial call. A custom `shouldRetry` replaces the built-in classifier. Anvia retries are additional to retries performed by the provider SDK. Core uses its configured local backoff and does not interpret provider `Retry-After` headers.

## CompletionRetryContext

```ts
type CompletionRetryContext = {
  error: unknown;
  attempt: number;
  maxAttempts: number;
  turn: number;
  streaming: boolean;
};
```

Purpose: context passed to a custom completion retry classifier. `attempt` identifies the failed attempt and is one-based.

## PromptResponse

```ts
type PromptResponse = {
  output: string;
  usage: Usage;
  messages: Message[];
  trace?: AgentTraceInfo;
};
```

Purpose: final non-streaming agent result.

Return behavior: `messages` contains the new run messages, not the full prior history unless history was manually included.

## AgentStreamEvent

```ts
type AgentChildStreamEvent = Exclude<AgentStreamEvent, { type: "agent_tool_event" }>;

type AgentErrorStreamEvent = {
  type: "error";
  error: unknown;
  usage: Usage;
};

type AgentStreamOptions = {
  includeToolCallDeltas?: boolean;
};

type AgentToolCallDeltaEvent = {
  type: "tool_call_delta";
  turn: number;
  id: string;
  callId?: string;
  name?: string;
  argumentsDelta?: string;
  argumentsMode?: "append" | "replace";
  signature?: string;
};

type AgentStreamEvent =
  | { type: "turn_start"; turn: number; prompt: Message; history: Message[] }
  | { type: "text_delta"; turn: number; delta: string }
  | { type: "reasoning_delta"; turn: number; delta: string; id?: string; contentType?: "text" | "summary" | "encrypted" | "redacted"; signature?: string }
  | AgentToolCallDeltaEvent
  | { type: "tool_call"; turn: number; toolCall: ToolCall }
  | { type: "tool_result"; turn: number; toolName: string; toolCallId?: string; internalCallId: string; args: string; result: string }
  | { type: "agent_tool_event"; turn: number; toolName: string; toolCallId?: string; internalCallId: string; agentId: string; agentName?: string; event: AgentChildStreamEvent }
  | { type: "turn_end"; turn: number; response: CompletionResponse }
  | { type: "final"; runId: string; output: string; usage: Usage; messages: Message[]; trace?: AgentTraceInfo }
  | AgentErrorStreamEvent;

type AgentChildStreamEventWithoutToolCallDeltas = Exclude<
  AgentChildStreamEvent,
  { type: "tool_call_delta" }
>;

type AgentStreamEventWithoutToolCallDeltas =
  | AgentChildStreamEventWithoutToolCallDeltas
  | { type: "agent_tool_event"; turn: number; toolName: string; toolCallId?: string; internalCallId: string; agentId: string; agentName?: string; event: AgentChildStreamEventWithoutToolCallDeltas };

type AgentChildStreamEventWithToolCallDeltas = AgentChildStreamEvent;
type AgentStreamEventWithToolCallDeltas = AgentStreamEvent;
```

Purpose: streaming event union for observing agent execution.

Return behavior: emitted by `PromptRequest.stream()` and `readableStream()`. `agent_tool_event` appears when a child agent is exposed with `asTool({ stream: true })`.

Tool-call deltas are provisional events emitted by default. They are emitted immediately, including
through streaming child agents, and may precede completion-response middleware. Missing
`argumentsMode` means append; `"replace"` means the fragment is a full snapshot. Only a completed
`tool_call` is safe to execute. Pass `{ includeToolCallDeltas: false }` for strict legacy consumers;
the returned stream then narrows to `AgentStreamEventWithoutToolCallDeltas`.

Agent error usage is cumulative across completed turns and any failed provider attempts that report
authoritative usage. It is `Usage.empty()` when the runtime has not received authoritative usage.
After yielding an error event, the async iterator rejects its next read with the same error.

## Errors

```ts
class MaxTurnsError extends Error {
  readonly maxTurns: number;
  readonly chatHistory: Message[];
  readonly prompt: Message;
}

class PromptCancelledError extends Error {
  readonly chatHistory: Message[];
  readonly reason: string;
}

class ToolApprovalRequiredError extends Error {
  readonly request: ToolApprovalRequest;
}
```

Purpose: typed prompt-run failures.

Return behavior: thrown by `PromptRequest.send()` and `PromptRequest.stream()`; stream failures are also yielded as `{ type: "error" }` before the async iterator throws.
