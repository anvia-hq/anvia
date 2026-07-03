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
<Thread.Messages>
  {(message) => (
    <Message.Root className="message">
      <Message.Content className="message-content">
        <Message.Parts />
      </Message.Content>
      <Message.Actions className="message-actions">
        <Message.Copy>Copy</Message.Copy>
        <Message.Regenerate>Retry</Message.Regenerate>
      </Message.Actions>
    </Message.Root>
  )}
</Thread.Messages>
```

`Message.Root` exposes `data-role`, so CSS can treat user, assistant, system, and tool messages
differently.

```css
.message[data-role="user"] {
  justify-items: end;
}

.message[data-role="assistant"] {
  justify-items: start;
}
```

## Parts

`Message.Parts` renders every part from `message.parts`. The default renderer selects the matching
primitive for text, reasoning, tool, attachment, data, and error parts.

```tsx
<Message.Parts filter={(part) => part.type !== "reasoning"}>
  {(part) => {
    if (part.type === "text") {
      return (
        <Message.Part className="text-part">
          <Message.Text />
        </Message.Part>
      );
    }

    return <Message.Part className="message-part" />;
  }}
</Message.Parts>
```

Focused primitives are available for `Message.Text`, `Message.Markdown`, `Message.Reasoning`,
`Message.Tool`, `Message.Attachment`, `Message.Data`, and `Message.Error`.

## Markdown

Use `Message.Markdown` when assistant text should render GitHub-flavored Markdown. Pass
`components` when code blocks, links, or headings should use app-owned components.

```tsx
<Message.Parts>
  {(part) =>
    part.type === "text" ? (
      <Message.Part>
        <Message.Markdown
          components={{
            code(props) {
              return <CodeBlock {...props} />;
            },
            a(props) {
              return <a {...props} target="_blank" rel="noreferrer" />;
            },
          }}
        />
      </Message.Part>
    ) : (
      <Message.Part />
    )
  }
</Message.Parts>
```

## Attachments and data

Attachment parts can use the default renderer or a custom attachment layout.

```tsx
<Message.Parts>
  {(part) =>
    part.type === "attachment" ? (
      <Message.Part className="attachment-part">
        <Message.Attachment className="attachment-card" />
      </Message.Part>
    ) : part.type === "data" ? (
      <Message.Part className="data-part">
        <Message.Data />
      </Message.Part>
    ) : (
      <Message.Part />
    )
  }
</Message.Parts>
```

## Actions

`Message.Copy` copies text content from the current message. `Message.Regenerate` calls the chat
controller's `regenerate()` action and is only enabled for assistant messages when the chat is not
streaming.

```tsx
<Message.Actions className="message-actions">
  <Message.Copy asChild>
    <button type="button">Copy answer</button>
  </Message.Copy>
  <Message.Regenerate asChild>
    <button type="button">Try again</button>
  </Message.Regenerate>
</Message.Actions>
```

For a larger message recipe, see [Message rendering](/docs/react-ui/examples/message-rendering).
