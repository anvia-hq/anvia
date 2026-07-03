---
title: Examples
description: Recipe-style examples for building @anvia/react-ui surfaces.
section: react-ui
sidebar:
  group: Examples
  order: 0
  label: Examples
---

These examples show complete composition patterns rather than isolated primitives. Use them as
starting points for app-owned chat, completion, tool-call, and review experiences.

## Recipes

- [Full chat surface](/docs/react-ui/examples/chat-surface): thread layout, suggestions, message rows, composer, and scroll controls.
- [Composer attachments](/docs/react-ui/examples/composer-attachments): file picker, direct file input, dropzone, controlled attachments, and custom attachment rows.
- [Message rendering](/docs/react-ui/examples/message-rendering): Markdown, custom code blocks, attachments, actions, and role-based layout.
- [Tool and human input](/docs/react-ui/examples/tool-human-input): tool cards, pending/settled filtering, approvals, and questions.
- [Styling recipe](/docs/react-ui/examples/styling): application CSS for a usable chat UI with headless primitives.
- [Completion panel](/docs/react-ui/examples/completion): prompt-to-text completion surface with custom output rendering.

## Minimal message row

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

## Minimal composer

```tsx
import { Composer } from "@anvia/react-ui";

export function ChatComposer() {
  return (
    <Composer.Root className="composer">
      <Composer.Attachments />
      <Composer.AddAttachment>Attach</Composer.AddAttachment>
      <Composer.Input maxRows={6} placeholder="Send a message..." />
      <Composer.Stop>Stop</Composer.Stop>
      <Composer.Submit>Send</Composer.Submit>
    </Composer.Root>
  );
}
```
