---
title: Chat and composer
description: Compose chat threads, message lists, scroll controls, and prompt input with @anvia/react-ui.
section: react-ui
sidebar:
  group: Primitives
  order: 1
  label: Chat and composer
---

## Chat provider

`ChatProvider` binds a `useChat(...)` controller from `@anvia/react` to the UI primitives.
Everything inside the provider reads from the same messages, status, errors, suggestions, and
actions.

```tsx
import { useChat } from "@anvia/react";
import { ChatProvider, Composer, Thread } from "@anvia/react-ui";

export function ChatSurface() {
  const chat = useChat({
    endpoint: "/api/chat",
    suggestions: [
      { id: "summarize", label: "Summarize", prompt: "Summarize this conversation." },
      { id: "plan", label: "Make a plan", prompt: "Turn this into an implementation plan." },
    ],
  });

  return (
    <ChatProvider controller={chat}>
      <Thread.Root className="chat">
        <Thread.Viewport className="chat-scroll">
          <Thread.Empty>No messages yet.</Thread.Empty>
          <Thread.Suggestions className="suggestions" />
          <Thread.Messages className="messages" />
          <Thread.ViewportFooter>
            <Thread.ScrollToBottom>Jump to latest</Thread.ScrollToBottom>
          </Thread.ViewportFooter>
        </Thread.Viewport>

        <Composer.Root className="composer">
          <Composer.Attachments />
          <Composer.AddAttachment>Attach</Composer.AddAttachment>
          <Composer.Input placeholder="Message Anvia..." maxRows={6} />
          <Composer.Submit>Send</Composer.Submit>
          <Composer.Stop>Stop</Composer.Stop>
        </Composer.Root>
      </Thread.Root>
    </ChatProvider>
  );
}
```

## Thread primitives

`Thread.Root` owns scroll state. `Thread.Viewport` registers the scroll container, tracks whether
the user is at the bottom, and auto-scrolls while new messages arrive.

```tsx
<Thread.Root className="chat">
  <Thread.Viewport className="chat-scroll" autoScroll>
    <Thread.Empty className="empty-state">Ask your first question.</Thread.Empty>
    <Thread.Messages className="messages" />
    <Thread.Error className="thread-error" />
    <Thread.ScrollToBottom className="scroll-button">Latest</Thread.ScrollToBottom>
  </Thread.Viewport>
</Thread.Root>
```

`Thread.Messages` renders the current messages. With no children it renders the default message
layout. With a function child it lets the app control each row.

```tsx
<Thread.Messages keepMounted={false}>
  {(message) => (
    <Message.Root className={message.role === "user" ? "bubble user" : "bubble"}>
      <Message.Content>
        <Message.Parts />
      </Message.Content>
    </Message.Root>
  )}
</Thread.Messages>
```

`Thread.Suggestions` renders prompts configured with `useChat({ suggestions })`. Suggestions
unmount when empty unless `keepMounted` is enabled.

```tsx
<Thread.Suggestions className="suggestions">
  {(suggestion) => (
    <Thread.Suggestion className="suggestion" suggestion={suggestion}>
      {suggestion.label}
    </Thread.Suggestion>
  )}
</Thread.Suggestions>
```

## Composer primitives

`Composer.Root` owns the draft text and pending attachments by default. `Composer.Input`
auto-resizes from `minRows` to `maxRows` rows, submits on Enter, keeps Shift+Enter for new lines,
and disables while the chat is streaming.

```tsx
<Composer.Root className="composer">
  <Composer.Attachments className="attachments" />
  <Composer.Input minRows={1} maxRows={6} placeholder="Send a message..." />
  <Composer.Stop>Stop</Composer.Stop>
  <Composer.Submit>Send</Composer.Submit>
</Composer.Root>
```

Use controlled props when the draft or attachments need to be mirrored into app state.

```tsx
<Composer.Root
  input={draft}
  onInputChange={setDraft}
  attachments={attachments}
  onAttachmentsChange={setAttachments}
>
  <Composer.Attachments keepMounted />
  <Composer.Input />
  <Composer.Submit />
</Composer.Root>
```

## Attachments

Use `Composer.AddAttachment` for a ready-made file-picker button, `Composer.AttachmentInput` when a
design system owns the input trigger, and `Composer.AttachmentDropzone` for drag-and-drop.

```tsx
<Composer.AttachmentDropzone className="dropzone">
  <Composer.Attachments className="attachments" />
  <Composer.AddAttachment accept="image/*,.pdf" multiple>
    Attach image or PDF
  </Composer.AddAttachment>
  <Composer.Input />
  <Composer.Submit />
</Composer.AttachmentDropzone>
```

For a complete attachment recipe, see [Composer attachments](/docs/react-ui/examples/composer-attachments).
