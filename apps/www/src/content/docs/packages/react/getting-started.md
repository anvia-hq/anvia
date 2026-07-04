---
title: "@anvia/react: Getting Started"
description: "Install @anvia/react and wire it into an Anvia project."
section: packages
sidebar:
  group: "@anvia/react"
  order: 2
  label: "Getting Started"
---
## Install

```sh
pnpm add @anvia/react
```

## Choose a hook

Use `useChat(...)` for a message transcript with follow-up turns, tool calls, human input, or
attachments. Use `useCompletion(...)` for one prompt input and one generated text output. Both hooks
send `{ messages, stream: true }` by default, so the server route can share the same basic request
parser even when the client state is different.

## Minimum setup

```tsx
import { useChat } from "@anvia/react";
import { useState } from "react";

export function SupportChat() {
  const chat = useChat({ endpoint: "http://localhost:8787/api/chat" });
  const [input, setInput] = useState("");

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void chat.sendMessage(input);
        setInput("");
      }}
    >
      <div>{chat.text}</div>
      <input value={input} onChange={(event) => setInput(event.currentTarget.value)} />
      <button disabled={chat.status === "streaming"}>Send</button>
    </form>
  );
}
```
The API app endpoint should accept `{ messages, stream: true }` and return Anvia stream events. For
component primitives on top of this hook, see [React UI](/docs/react-ui/overview).

## Minimal completion

```tsx
import { useCompletion } from "@anvia/react";

export function DraftBox() {
  const completion = useCompletion({ endpoint: "http://localhost:8787/api/completion" });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        void completion.complete(String(form.get("prompt") ?? ""));
        event.currentTarget.reset();
      }}
    >
      <textarea name="prompt" />
      <button disabled={completion.status === "streaming"}>Complete</button>
      <output>{completion.completion}</output>
    </form>
  );
}
```

## Next step

Continue with [Usage Patterns](/docs/packages/react/usage-patterns).
