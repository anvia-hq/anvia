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
  readableStream(options?: ReadableStreamOptions): ReadableStream<AgentStreamEvent>;
}
```

Purpose: per-run request state returned by `agent.prompt(...)` or `agent.session(...).prompt(...)`.

Return behavior: `send()` resolves a final response; `stream()` yields agent run events and ends with a `final` event; `readableStream()` wraps the async iterable in a web stream.

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

type AgentStreamEvent =
  | { type: "turn_start"; turn: number; prompt: Message; history: Message[] }
  | { type: "text_delta"; turn: number; delta: string }
  | { type: "reasoning_delta"; turn: number; delta: string; id?: string; contentType?: "text" | "summary" | "encrypted" | "redacted"; signature?: string }
  | { type: "tool_call"; turn: number; toolCall: ToolCall }
  | { type: "tool_result"; turn: number; toolName: string; toolCallId?: string; internalCallId: string; args: string; result: string }
  | { type: "agent_tool_event"; turn: number; toolName: string; toolCallId?: string; internalCallId: string; agentId: string; agentName?: string; event: AgentChildStreamEvent }
  | { type: "turn_end"; turn: number; response: CompletionResponse }
  | { type: "final"; runId: string; output: string; usage: Usage; messages: Message[]; trace?: AgentTraceInfo }
  | { type: "error"; error: unknown };
```

Purpose: streaming event union for observing agent execution.

Return behavior: emitted by `PromptRequest.stream()` and `readableStream()`. `agent_tool_event` appears when a child agent is exposed with `asTool({ stream: true })`.

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
