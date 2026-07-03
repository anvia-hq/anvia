---
title: "@anvia/react-ui: Getting Started"
description: "Install @anvia/react-ui and compose Anvia chat primitives."
section: packages
sidebar:
  group: "@anvia/react-ui"
  order: 2
  label: "Getting Started"
---
## Install

```sh
pnpm add @anvia/react @anvia/react-ui
```

## Chat setup

```tsx
import { useChat } from "@anvia/react";
import { ChatProvider, Composer, Message, Thread } from "@anvia/react-ui";
import "@anvia/react-ui/styles.css";

export function SupportChat() {
  const chat = useChat({ endpoint: "/api/chat" });

  return (
    <ChatProvider controller={chat}>
      <Thread.Root>
        <Thread.Viewport>
          <Thread.Empty>Start a conversation.</Thread.Empty>
          <Thread.Suggestions />
          <Thread.Messages>
            <Message.Root>
              <Message.Content>
                <Message.Parts />
              </Message.Content>
              <Message.Actions />
            </Message.Root>
          </Thread.Messages>
          <Thread.Error />
          <Thread.ScrollToBottom>Jump to latest</Thread.ScrollToBottom>
        </Thread.Viewport>

        <Composer.Root>
          <Composer.Attachments />
          <Composer.AddAttachment>Attach</Composer.AddAttachment>
          <Composer.Input placeholder="Send a message..." />
          <Composer.Stop>Stop</Composer.Stop>
          <Composer.Submit>Send</Composer.Submit>
        </Composer.Root>
      </Thread.Root>
    </ChatProvider>
  );
}
```

## Completion setup

```tsx
import { useCompletion } from "@anvia/react";
import { Completion, CompletionProvider } from "@anvia/react-ui";

export function DraftBox() {
  const completion = useCompletion({ endpoint: "/api/completion" });

  return (
    <CompletionProvider controller={completion}>
      <Completion.Root>
        <Completion.Output />
        <Completion.Form>
          <Completion.Input placeholder="Write a prompt..." />
          <Completion.Stop>Stop</Completion.Stop>
          <Completion.Submit>Complete</Completion.Submit>
        </Completion.Form>
      </Completion.Root>
    </CompletionProvider>
  );
}
```

## Next step

Continue with [Usage Patterns](/docs/packages/react-ui/usage-patterns).
