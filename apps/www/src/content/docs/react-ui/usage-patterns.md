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
    if (part.type === "attachment") {
      return <AttachmentPreview attachment={part.attachment} />;
    }

    return <Message.Part />;
  }}
</Message.Parts>
```

## Attach files in the composer

`Composer.AddAttachment` opens a file picker, `Composer.AttachmentDropzone` accepts dropped files,
and `Composer.Attachments` renders the pending attachments before the prompt is sent.

```tsx
<Composer.Root>
  <Composer.Attachments />
  <Composer.AddAttachment />
  <Composer.Input minRows={1} maxRows={6} />
  <Composer.Submit />
</Composer.Root>
```
