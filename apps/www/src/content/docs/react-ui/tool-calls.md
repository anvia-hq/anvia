---
title: Tool calls
description: Render pending, settled, and custom tool call states in message parts.
section: react-ui
sidebar:
  group: Primitives
  order: 3
  label: Tool calls
---

## Default rendering

`Message.Tool` renders tool-call message parts. By default it shows the tool name, input, output,
and error content when each field is available.

```tsx
<Message.Parts>
  <Message.Part />
</Message.Parts>
```

The default `Message.Part` renderer delegates tool parts to `Message.Tool`, so most chat surfaces
get tool rendering without extra code.

## Pending and settled states

Use `renderWhen` to decide when a tool call should appear.

```tsx
<Message.Tool renderWhen="pending" className="tool-call pending" />
<Message.Tool renderWhen="settled" className="tool-call settled" />
```

`renderWhen="always"` is the default. Pending means the input is streaming or available. Settled
means output is available or the tool call ended in an error.

## Custom tool components

The child function receives the full tool part, so consumers can merge input, result, and error into
one application-specific component.

```tsx
<Message.Tool>
  {(part) => (
    <ToolCallCard
      name={part.toolName}
      state={part.state}
      input={part.input}
      output={part.output}
      error={part.error}
    />
  )}
</Message.Tool>
```

For design-system layouts, compose the smaller tool primitives instead of formatting the part
manually.

```tsx
<Message.Tool className="tool-card">
  <header>
    <Message.ToolName />
    <Message.ToolStatus />
  </header>
  <Message.ToolInput />
  <Message.ToolOutput />
  <Message.ToolError />
</Message.Tool>
```
