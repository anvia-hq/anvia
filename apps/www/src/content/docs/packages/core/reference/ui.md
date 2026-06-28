---
title: "UI"
description: "UI message stream protocol and adapters."
section: packages
sidebar:
  group: "Reference"
  order: 22
  label: "UI"
---
Import from `@anvia/core` or `@anvia/core/ui`.

## Types

```ts
type UIMessageRole = "system" | "user" | "assistant" | "tool";

type UIError = {
  name?: string;
  message: string;
};

type UIMessage = {
  id: string;
  role: UIMessageRole;
  parts: UIMessagePart[];
  metadata?: JsonValue;
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
      input?: JsonValue;
      output?: JsonValue;
      error?: UIError;
    }
  | { id: string; type: "data"; name: string; data: JsonValue }
  | { id: string; type: "error"; error: UIError };

type UIStreamRequest = {
  messages: UIMessage[];
  stream: true;
  metadata?: JsonValue;
};

type UIStreamEvent =
  | { type: "message_start"; message: UIMessage }
  | { type: "text_delta"; messageId: string; partId: string; delta: string }
  | { type: "reasoning_delta"; messageId: string; partId: string; delta: string }
  | { type: "tool_update"; messageId: string; partId: string; part: UIMessagePart }
  | { type: "message_end"; messageId: string; usage?: Usage; metadata?: JsonValue }
  | { type: "error"; error: UIError };

type CreateCompletionUIStreamOptions = Omit<
  CreateCompletionStreamOptions,
  "input" | "messages"
> & {
  messages: UIMessage[];
};

type AgentLike = {
  prompt(prompt: string | Message | Message[]): {
    stream(): AsyncIterable<AgentStreamEvent>;
  };
};

type CreateAgentUIStreamOptions = {
  messages: UIMessage[];
};
```

Purpose: shared UI message shape for React-facing completion and chat state. The request always carries `messages`. React hooks can consume raw completion streams, raw agent streams, or `UIStreamEvent` records.

## uiMessagesToCoreMessages

```ts
function uiMessagesToCoreMessages(messages: UIMessage[]): Message[];
```

Purpose: convert client-facing UI messages into core completion messages before calling completion or agent APIs.

Return behavior: text, reasoning, tool call, and tool output parts are mapped into the closest core message representation.

## coreMessagesToUIMessages

```ts
function coreMessagesToUIMessages(messages: Message[]): UIMessage[];
```

Purpose: convert existing core message history into the UI message shape used by React hooks and UI stream requests.

Return behavior: generated IDs are assigned where the core message format does not already provide one.

## createCompletionUIStream

```ts
function createCompletionUIStream<Model extends StreamingCompletionModel>(
  model: Model,
  options: CreateCompletionUIStreamOptions,
): AsyncIterable<UIStreamEvent>;
```

Purpose: advanced adapter that runs `createCompletionStream(...)` from UI messages and adapts the completion stream into UI stream events.

Return behavior: yields an assistant `message_start`, text or reasoning deltas, tool updates, `message_end`, and error events.

For normal React completion routes, prefer calling `createCompletionStream(model, { messages: body.messages })` directly.

## createAgentUIStream

```ts
function createAgentUIStream(
  agent: AgentLike,
  options: CreateAgentUIStreamOptions,
): AsyncIterable<UIStreamEvent>;
```

Purpose: advanced adapter that runs an agent from UI messages and adapts the agent stream into the UI stream protocol.

Return behavior: yields assistant message events that can be consumed by `useChat` or `useCompletion` from `@anvia/react`.

## completionStreamToUIStream

```ts
function completionStreamToUIStream(
  events: AsyncIterable<CompletionStreamEvent>,
  options?: { messageId?: string },
): AsyncIterable<UIStreamEvent>;
```

Purpose: adapt an existing `CompletionStreamEvent` iterable into the standard UI stream protocol.

Return behavior: preserves streamed deltas and emits any missing final text delta when the final response contains more text than was streamed.

## agentStreamToUIStream

```ts
function agentStreamToUIStream(
  events: AsyncIterable<AgentStreamEvent>,
  options?: { messageId?: string },
): AsyncIterable<UIStreamEvent>;
```

Purpose: adapt an existing agent stream iterable into the standard UI stream protocol.

Return behavior: maps agent text, reasoning, tool call, tool result, final, and error events to `UIStreamEvent` records.
