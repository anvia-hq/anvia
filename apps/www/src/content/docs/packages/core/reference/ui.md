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

type UIAttachment = {
  id: string;
  type: "image" | "document" | "file";
  name?: string;
  mediaType?: string;
  url?: string;
  data?: string;
  text?: string;
  detail?: "auto" | "low" | "high";
  metadata?: JsonValue;
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
      input?: JsonValue;
      output?: JsonValue;
      error?: UIError;
    }
  | { id: string; type: "data"; name: string; data: JsonValue }
  | { id: string; type: "attachment"; attachment: UIAttachment }
  | { id: string; type: "error"; error: UIError };

type UIStreamRequest = {
  messages: Message[];
  stream: true;
  metadata?: JsonValue;
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
  | { type: "message_end"; messageId: string; usage?: Usage; metadata?: JsonValue }
  | { type: "error"; error: UIError };

```

Purpose: shared UI message shape for React-facing completion and chat state. React hooks can consume raw completion streams, raw agent streams, or `UIStreamEvent` records.

## uiMessagesToCoreMessages

```ts
function uiMessagesToCoreMessages(messages: UIMessage[]): Message[];
```

Purpose: convert client-facing UI messages into core completion messages before calling completion or agent APIs.

Return behavior: text, attachment, reasoning, tool call, tool output, and strict JSON message
metadata are mapped into the closest core message representation.

## coreMessagesToUIMessages

```ts
function coreMessagesToUIMessages(messages: Message[]): UIMessage[];
```

Purpose: convert existing core message history into the UI message shape used by React hooks.

Return behavior: generated IDs are assigned where the core message format does not already provide
one, and core message metadata is restored onto the `UIMessage`. Metadata-free tool-result messages
continue to merge into matching assistant tool parts. A metadata-bearing tool message remains a
standalone UI tool message so its metadata and transcript structure are not lost.

The supported persistence round trip is:

```ts
const coreMessages = uiMessagesToCoreMessages(uiMessages);
const stored = JSON.stringify(coreMessages);
const restored = coreMessagesToUIMessages(JSON.parse(stored));
```

Server handlers can pass converted core messages directly to completion or agent APIs. `@anvia/react` can consume raw completion streams, raw agent streams, or `UIStreamEvent` records.
