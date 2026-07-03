---
title: Getting started
description: Install @anvia/react-ui and wire it to an Anvia chat controller.
section: react-ui
sidebar:
  group: Start Here
  order: 2
  label: Getting started
---

Install the UI package beside the React hook package.

```sh
pnpm add @anvia/react @anvia/react-ui
```

## Chat setup

Create a `useChat(...)` controller, pass it to `ChatProvider`, then compose the thread and composer
primitives.

```tsx
import { useChat } from "@anvia/react";
import { ChatProvider, Composer, Thread } from "@anvia/react-ui";

export function SupportChat() {
  const chat = useChat({ endpoint: "/api/chat" });

  return (
    <ChatProvider controller={chat}>
      <Thread.Root className="chat">
        <Thread.Viewport className="chat-scroll">
          <Thread.Empty>Start a conversation.</Thread.Empty>
          <Thread.Messages />
        </Thread.Viewport>

        <Composer.Root className="composer">
          <Composer.Input placeholder="Ask a question..." />
          <Composer.Submit />
          <Composer.Stop />
        </Composer.Root>
      </Thread.Root>
    </ChatProvider>
  );
}
```

## Optional CSS

For prototypes, import the package stylesheet.

```tsx
import "@anvia/react-ui/styles.css";
```

Production apps can skip the stylesheet and use `className`, `asChild`, and `data-anvia-*`
selectors instead.
