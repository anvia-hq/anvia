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

## Choose a surface

Use chat for transcripts, follow-up turns, tools, attachments, and human review. Use completion for
one prompt input and one generated text result. The hooks can share the same request shape, but their
providers and primitives are separate.

## Chat setup

```tsx
import { useChat } from "@anvia/react";
import { ChatProvider, Composer, Thread } from "@anvia/react-ui";
import "@anvia/react-ui/styles.css";

export function SupportChat() {
  const chat = useChat({ endpoint: "http://localhost:8787/api/chat" });

  return (
    <ChatProvider controller={chat}>
      <Thread.Root>
        <Thread.Viewport>
          <Thread.Empty>Start a conversation.</Thread.Empty>
          <Thread.Suggestions />
          <Thread.Messages />
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

The API app endpoint should accept `{ messages, stream: true }` and stream Anvia events. For the
full route setup, see [React UI server routes](/docs/react-ui/server-routes).

## Completion setup

```tsx
import { useCompletion } from "@anvia/react";
import { Completion, CompletionProvider } from "@anvia/react-ui";

export function DraftBox() {
  const completion = useCompletion({ endpoint: "http://localhost:8787/api/completion" });

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

Continue with [Usage Patterns](/docs/packages/react-ui/usage-patterns), or use the dedicated
[React UI TanStack quickstart](/docs/react-ui/quickstart-tanstack).
