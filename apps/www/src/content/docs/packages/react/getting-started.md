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

export function SupportChat() {
  const chat = useChat({ endpoint: "/api/chat" });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void chat.send();
      }}
    >
      <div>{chat.text}</div>
      <input value={chat.input} onChange={(event) => chat.setInput(event.target.value)} />
      <button disabled={chat.status === "streaming"}>Send</button>
    </form>
  );
}
```
## Next step

Continue with [Usage Patterns](/docs/packages/react/usage-patterns).
