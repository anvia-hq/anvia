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
<Message.Tool renderWhen="always" className="tool-call" />
<Message.Tool renderWhen="pending" className="tool-call pending" />
<Message.Tool renderWhen="settled" className="tool-call settled" />
```

`renderWhen="always"` is the default. Pending means the input is streaming or available. Settled
means output is available or the tool call ended in an error.

## Custom tool cards

The child function receives the full tool part, so consumers can merge input, output, and error into
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
  <header className="tool-card-header">
    <Message.ToolName />
    <Message.ToolStatus />
  </header>
  <section className="tool-card-section">
    <Message.ToolInput />
  </section>
  <section className="tool-card-section">
    <Message.ToolOutput />
    <Message.ToolError />
  </section>
</Message.Tool>
```

## Filtering noisy tools

Use `Message.Parts` filtering when a surface should hide tool calls until a result is available.

```tsx
<Message.Parts
  filter={(part) => part.type !== "tool" || part.state === "output-available"}
/>
```

Use the inverse for an activity panel that only shows pending tool work.

```tsx
<Message.Parts filter={(part) => part.type === "tool" && part.state !== "output-available"}>
  <Message.Part />
</Message.Parts>
```

For a combined tool and review flow, see [Tool and human input](/docs/react-ui/examples/tool-human-input).
