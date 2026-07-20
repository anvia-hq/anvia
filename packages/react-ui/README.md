# @anvia/react-ui

Composable React UI primitives for Anvia chat and completion experiences.

```tsx
import { useChat } from "@anvia/react";
import { ChatProvider, Composer, Message, Thread } from "@anvia/react-ui";

export function SupportChat() {
  const chat = useChat({ endpoint: "/api/chat" });
  const triggers = [
    {
      id: "people",
      char: "@",
      items: [{ id: "user_ada", label: "Ada Lovelace", data: { type: "user" } }],
    },
  ];

  return (
    <ChatProvider controller={chat}>
      <Thread.Root>
        <Thread.Viewport>
          <Thread.Empty>Start a conversation.</Thread.Empty>
          <Thread.Suggestions />
          <Thread.Messages>
            <Message.Root>
              <Message.Content>
                <Message.Parts />
              </Message.Content>
              <Message.Actions />
            </Message.Root>
          </Thread.Messages>
          <Thread.Error />
          <Thread.ScrollToBottom>Jump to latest</Thread.ScrollToBottom>
        </Thread.Viewport>
        <Composer.Root triggers={triggers}>
          <Composer.Attachments />
          <Composer.AddAttachment>Attach</Composer.AddAttachment>
          <Composer.Input maxRows={6} placeholder="Send a message..." />
          <Composer.TriggerMenu />
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

The primitives are headless by default: pass `className` or `asChild` for design-system
integration, control `Composer.Root` with `input`/`attachments` props when needed, and use
`submitMessage` for custom composer payloads. Use `keepMounted` on optional collections when empty
wrappers are useful for layout.

`Composer.Input` is a Tiptap-backed rich composer. Configure `Composer.Root` with `triggers` to
support inline `@`, `/`, `$`, or other entity chips; selected entities are submitted under
`metadata.composer.entities`. Use `Composer.TextareaInput` when you need the previous native
textarea behavior.

Streaming smoothing is opt-in and display-only. Keep `useChat` as the owner of transport and
`UIMessage[]` state. Keep the lifecycle mounted after streaming stops so its buffered tail drains;
`Message.Parts` also keeps later tool parts behind text that has not been revealed yet:

```tsx
<Message.Parts
  stream={{
    isStreaming:
      chat.status === "streaming" &&
      message.role === "assistant" &&
      chat.messages.at(-1)?.id === message.id,
    resetKey: message.id,
    flushImmediately: chat.status === "error",
  }}
>
  {(part) => (part.type === "text" ? <Message.Markdown /> : <Message.Part />)}
</Message.Parts>
```

For app-owned text state, `StreamMarkdown` is available from `@anvia/react-ui/stream`. It is a
context-free renderer: pass the already displayed text as `content`, set `live` only for its growing
tail, and import `@anvia/react-ui/stream/styles.css` for the settle animation.
