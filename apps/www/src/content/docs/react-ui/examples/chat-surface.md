---
title: Full chat surface
description: Compose a complete @anvia/react-ui chat surface with messages, suggestions, scrolling, and composer controls.
section: react-ui
sidebar:
  group: Examples
  order: 1
  label: Full chat surface
---

This recipe starts from a `useChat(...)` controller and builds a complete app-owned chat screen.

```tsx
import { useChat } from "@anvia/react";
import { ChatProvider, Composer, Message, Thread } from "@anvia/react-ui";
import "@anvia/react-ui/styles.css";

export function AgentChat() {
  const chat = useChat({
    endpoint: "/api/chat",
    suggestions: [
      { id: "summarize", label: "Summarize", prompt: "Summarize this conversation." },
      { id: "risks", label: "Find risks", prompt: "What are the risks in this plan?" },
      { id: "next", label: "Next step", prompt: "Suggest the next implementation step." },
    ],
  });

  return (
    <ChatProvider controller={chat}>
      <Thread.Root className="chat">
        <Thread.Viewport className="chat-scroll">
          <Thread.Empty className="empty-state">
            <h1>What should we build?</h1>
            <Thread.Suggestions className="suggestions" />
          </Thread.Empty>

          <Thread.Messages className="messages">
            {(message) => (
              <Message.Root className="message">
                <Message.Content className="message-content">
                  <Message.Parts />
                </Message.Content>
                <Message.Actions className="message-actions">
                  <Message.Copy>Copy</Message.Copy>
                  <Message.Regenerate>Regenerate</Message.Regenerate>
                </Message.Actions>
              </Message.Root>
            )}
          </Thread.Messages>

          <Thread.Error className="thread-error" />
          <Thread.ScrollToBottom className="scroll-button">Jump to latest</Thread.ScrollToBottom>
        </Thread.Viewport>

        <Composer.Root className="composer">
          <Composer.Attachments className="composer-attachments" />
          <Composer.AddAttachment>Attach</Composer.AddAttachment>
          <Composer.Input minRows={1} maxRows={6} placeholder="Message the agent..." />
          <Composer.Stop>Stop</Composer.Stop>
          <Composer.Submit>Send</Composer.Submit>
        </Composer.Root>
      </Thread.Root>
    </ChatProvider>
  );
}
```

Add enough CSS to make the primitives behave like one surface.

```css
.chat {
  min-height: 100vh;
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
}

.chat-scroll {
  min-height: 0;
  padding: 24px;
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

.composer {
  width: min(760px, calc(100% - 32px));
  margin: 0 auto 16px;
  display: flex;
  gap: 8px;
  align-items: end;
}
```
