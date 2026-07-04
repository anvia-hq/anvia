---
title: "@anvia/react-ui: Examples"
description: "Small examples and links for @anvia/react-ui."
section: packages
sidebar:
  group: "@anvia/react-ui"
  order: 4
  label: "Examples"
---

The package page stays concise for package-reference coverage. The richer recipe set lives in the
dedicated [React UI examples](/docs/react-ui/examples).

The message snippet below assumes it is rendered by `Thread.Messages` or another message provider
inside `ChatProvider`. The composer snippet assumes `ChatProvider`. The completion snippet uses its
own `CompletionProvider`; chat primitives do not read completion context.

## Quick examples

```tsx
import { Message } from "@anvia/react-ui";

export function ChatMessage() {
  return (
    <Message.Root className="message">
      <Message.Content>
        <Message.Parts />
      </Message.Content>
      <Message.Actions>
        <Message.Copy>Copy</Message.Copy>
        <Message.Regenerate>Try again</Message.Regenerate>
      </Message.Actions>
    </Message.Root>
  );
}
```

```tsx
import { Composer } from "@anvia/react-ui";

export function AttachmentComposer() {
  return (
    <Composer.Root>
      <Composer.Attachments />
      <Composer.AddAttachment>Attach</Composer.AddAttachment>
      <Composer.Input maxRows={6} />
      <Composer.Submit>Send</Composer.Submit>
    </Composer.Root>
  );
}
```

```tsx
import { useCompletion } from "@anvia/react";
import { Completion, CompletionProvider } from "@anvia/react-ui";

export function CompletionPanel() {
  const completion = useCompletion({ endpoint: "http://localhost:8787/api/completion" });

  return (
    <CompletionProvider controller={completion}>
      <Completion.Root>
        <Completion.Output />
        <Completion.Form>
          <Completion.Input />
          <Completion.Submit />
        </Completion.Form>
      </Completion.Root>
    </CompletionProvider>
  );
}
```

## Recipe links

- [Full chat surface](/docs/react-ui/examples/chat-surface)
- [Composer attachments](/docs/react-ui/examples/composer-attachments)
- [Message rendering](/docs/react-ui/examples/message-rendering)
- [Tool and human input](/docs/react-ui/examples/tool-human-input)
- [Styling recipe](/docs/react-ui/examples/styling)
- [Completion panel](/docs/react-ui/examples/completion)
