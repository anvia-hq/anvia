---
title: Styling recipe
description: Application-owned CSS for a practical @anvia/react-ui chat surface.
section: react-ui
sidebar:
  group: Examples
  order: 5
  label: Styling recipe
---

The optional package stylesheet handles functional defaults. This recipe shows the kind of layout
CSS that should live in the app.

```tsx
<Thread.Root className="chat">
  <Thread.Viewport className="chat-scroll">
    <Thread.Empty className="empty-state">Start a conversation.</Thread.Empty>
    <Thread.Messages className="messages" />
    <Thread.ScrollToBottom className="scroll-button">Latest</Thread.ScrollToBottom>
  </Thread.Viewport>
  <Composer.Root className="composer">
    <Composer.Attachments className="attachment-list" />
    <Composer.Input placeholder="Ask..." />
    <Composer.Submit>Send</Composer.Submit>
  </Composer.Root>
</Thread.Root>
```

```css
.chat {
  min-height: 100vh;
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  background: var(--surface);
  color: var(--text);
}

.chat-scroll {
  min-height: 0;
  padding: 24px 16px;
}

.messages {
  width: min(760px, 100%);
  margin: 0 auto;
  display: grid;
  gap: 14px;
}

.message {
  display: grid;
  gap: 6px;
}

.message[data-role="user"] {
  justify-items: end;
}

.message[data-role="user"] .message-content {
  max-width: min(620px, 88%);
  padding: 10px 14px;
  border-radius: 18px;
  background: var(--user-bubble);
}

.message-actions {
  display: flex;
  gap: 6px;
}

.composer {
  width: min(760px, calc(100% - 32px));
  margin: 0 auto 16px;
  display: flex;
  gap: 8px;
  align-items: end;
  border: 1px solid var(--border);
  border-radius: 18px;
  padding: 8px;
}

.composer [data-anvia-composer-input] {
  width: 100%;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
}

.attachment-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
```

Use `data-state` for state-specific styling.

```css
[data-anvia-composer][data-state="streaming"] [data-anvia-submit] {
  display: none;
}

[data-anvia-scroll-to-bottom][data-state="bottom"] {
  visibility: hidden;
}
```
