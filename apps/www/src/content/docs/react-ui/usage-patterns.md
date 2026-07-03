---
title: Usage patterns
description: Common ways to compose @anvia/react-ui with @anvia/react and application-owned UI.
section: react-ui
sidebar:
  group: Start Here
  order: 3
  label: Usage patterns
---

## Pair it with @anvia/react

`@anvia/react-ui` expects controllers from `@anvia/react`.

- Use `useChat(...)` with `ChatProvider`, `Thread`, `Message`, `Composer`, and `HumanInput`.
- Use `useCompletion(...)` with `CompletionProvider` and `Completion`.
- Keep server routes, auth, persistence, and model selection outside the UI package.

## Stay headless

Every primitive accepts regular element props such as `className`. Button-like primitives also
support `asChild`, so applications can attach Anvia behavior to design-system components.

```tsx
<Composer.Submit asChild>
  <button className="primary-action">Send</button>
</Composer.Submit>
```

## Render streamed parts directly

`Message.Parts` renders Anvia `UIMessagePart` values by default. Use a child function to replace
the default rendering only where the product needs custom layout.

```tsx
<Message.Parts>
  {(part) => {
    if (part.type === "tool") {
      return <ToolCallCard part={part} />;
    }

    return <Message.Part />;
  }}
</Message.Parts>
```
