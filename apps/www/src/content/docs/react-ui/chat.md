---
title: Chat and composer
description: Compose chat threads, message lists, scroll controls, and prompt input with @anvia/react-ui.
section: react-ui
sidebar:
  group: Primitives
  order: 1
  label: Chat and composer
---

## Chat provider

`ChatProvider` binds a `useChat(...)` controller from `@anvia/react` to the UI primitives.
Everything inside the provider reads from the same chat state and actions.

```tsx
import { useChat } from "@anvia/react";
import { ChatProvider, Composer, Thread } from "@anvia/react-ui";

export function ChatSurface() {
  const chat = useChat({ endpoint: "/api/chat" });

  return (
    <ChatProvider controller={chat}>
      <Thread.Root className="chat">
        <Thread.Viewport className="chat-scroll">
          <Thread.Empty>No messages yet.</Thread.Empty>
          <Thread.Messages />
        </Thread.Viewport>

        <Composer.Root className="composer">
          <Composer.Input placeholder="Message Anvia..." />
          <Composer.Submit />
          <Composer.Stop />
        </Composer.Root>
      </Thread.Root>
    </ChatProvider>
  );
}
```

## Thread primitives

`Thread.Root` owns the scroll state. `Thread.Viewport` registers the scroll container, tracks
whether the user is at the bottom, and auto-scrolls while new messages arrive.

`Thread.Messages` renders the current chat messages. With no children it renders the default
message layout. With a function child it lets the app control each row.

```tsx
<Thread.Messages>
  {(message) => (
    <Message.Root className={message.role === "user" ? "bubble user" : "bubble"}>
      <Message.Content>
        <Message.Parts />
      </Message.Content>
    </Message.Root>
  )}
</Thread.Messages>
```

Use `Thread.ScrollToBottom` when the viewport can be scrolled away from the latest message.

## Composer primitives

`Composer.Root` owns the draft text for a single prompt. `Composer.Input` submits on Enter, keeps
Shift+Enter for new lines, and disables while the chat is streaming. `Composer.Submit` and
`Composer.Stop` reflect whether submit or stop is currently available.
