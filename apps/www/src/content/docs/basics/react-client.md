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

## Use chat state

```tsx
import { useChat } from "@anvia/react";

export function Chat() {
  const chat = useChat({ endpoint: "/api/chat" });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void chat.send();
      }}
    >
      <div>
        {chat.messages.map((message) => (
          <p key={message.id}>{message.content}</p>
        ))}
      </div>

      <input value={chat.input} onChange={(event) => chat.setInput(event.target.value)} />
      <button disabled={chat.status === "streaming"}>Send</button>
    </form>
  );
}
```

## What happens

`useChat` creates a fetch-backed transport when you pass `endpoint`. It sends chat input, reads JSONL by default, and updates message state from runtime events.

Use custom transports when your app has a different request shape or event mapping.

## Next

Send runtime events into application logs.

[Runtime logging](/docs/basics/runtime-logging)
