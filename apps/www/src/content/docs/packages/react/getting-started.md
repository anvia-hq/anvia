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

## Next step

Continue with [Usage Patterns](/docs/packages/react/usage-patterns).
