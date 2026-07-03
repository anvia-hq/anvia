---
title: Messages
description: Render Anvia UI message parts with composable message primitives.
section: react-ui
sidebar:
  group: Primitives
  order: 2
  label: Messages
---

## Message layout

`Message.Root` renders one `UIMessage`. In normal chat surfaces it is created by
`Thread.Messages`, but the message primitives can still be rearranged into any layout.

```tsx
<Message.Root className="message">
  <Message.Content>
    <Message.Parts />
  </Message.Content>
  <Message.Actions>
    <Message.Copy />
    <Message.Regenerate />
  </Message.Actions>
</Message.Root>
```

`Message.Root` exposes `data-role` so CSS can treat user, assistant, system, and tool messages
differently.

## Parts

`Message.Parts` renders every part from `message.parts`. The default renderer selects the matching
primitive for text, reasoning, tool, data, and error parts.

```tsx
<Message.Parts filter={(part) => part.type !== "reasoning"}>
  {(part) => {
    if (part.type === "text") {
      return <Message.Text className="prose" />;
    }

    return <Message.Part className="message-part" />;
  }}
</Message.Parts>
```

Focused primitives are available for `Message.Text`, `Message.Reasoning`, `Message.Tool`,
`Message.Data`, and `Message.Error`.

## Actions

`Message.Copy` copies the text content from the current message. `Message.Regenerate` calls the
chat controller's `regenerate()` action and is only enabled for assistant messages when the chat is
not streaming.
