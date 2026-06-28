---
title: React client
description: Consume runtime streams from React applications.
section: basics
sidebar:
  group: App integration
  order: 2
---

Use `@anvia/react` when a React UI should send chat input and render streamed runtime output.

## When to use this

Use the React client after your server route returns runtime events with `@anvia/server`.

The client sends user input to an endpoint and updates state as events arrive.

## Prerequisites

Install `@anvia/react` and expose a server route that returns Anvia runtime events.

## Use chat state

```tsx
import { useChat } from "@anvia/react";
import { useState } from "react";

export function Chat() {
  const chat = useChat({ endpoint: "/api/chat" });
  const [input, setInput] = useState("");

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void chat.sendMessage(input);
        setInput("");
      }}
    >
      <div>
        {chat.messages.map((message) => (
          <p key={message.id}>
            {message.parts
              .filter((part) => part.type === "text")
              .map((part) => part.text)
              .join("")}
          </p>
        ))}
      </div>

      <input value={input} onChange={(event) => setInput(event.target.value)} />
      <button disabled={chat.status === "streaming"}>Send</button>
    </form>
  );
}
```

## What happens

`useChat` creates a fetch-backed transport when you pass `endpoint`. It sends the default chat request body:

```ts
type UIStreamRequest = {
  messages: UIMessage[];
  stream: true;
  metadata?: JsonValue;
};
```

It reads JSONL by default and updates message state from raw completion streams, raw agent streams, or UI stream events.

Use `createRequest` or a custom transport when your server expects a different request shape or event mapping.

## Check yourself

Submit the form and confirm messages update while the request is active. The submit button should be disabled during streaming.

## Next

Send runtime events into application logs.

[Runtime logging](/docs/basics/runtime-logging)
