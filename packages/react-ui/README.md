# @anvia/react-ui

Composable React UI primitives for Anvia chat and completion experiences.

```tsx
import { useChat } from "@anvia/react";
import { ChatProvider, Composer, Message, Thread } from "@anvia/react-ui";

export function SupportChat() {
  const chat = useChat({ endpoint: "/api/chat" });

  return (
    <ChatProvider controller={chat}>
      <Thread.Root>
        <Thread.Viewport>
          <Thread.Empty>Start a conversation.</Thread.Empty>
          <Thread.Messages>
            <Message.Root>
              <Message.Content>
                <Message.Parts />
              </Message.Content>
              <Message.Actions />
            </Message.Root>
          </Thread.Messages>
          <Thread.ScrollToBottom>Jump to latest</Thread.ScrollToBottom>
        </Thread.Viewport>
        <Composer.Root>
          <Composer.Input placeholder="Send a message..." />
          <Composer.Stop>Stop</Composer.Stop>
          <Composer.Submit>Send</Composer.Submit>
        </Composer.Root>
      </Thread.Root>
    </ChatProvider>
  );
}
```

Import `@anvia/react-ui/styles.css` for a small default stylesheet, or style the stable
`data-anvia-*` attributes directly.
