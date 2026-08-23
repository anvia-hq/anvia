# @anvia/react-ui

Composable React UI primitives for Anvia chat and completion experiences.

```tsx
import { createHttpClientTransport } from "@anvia/client";
import { useChat } from "@anvia/react";
import {
  ChatProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
} from "@anvia/react-ui";

export function SupportChat() {
  const chat = useChat({
    transport: createHttpClientTransport({ endpoint: "/api/chat" }),
  });
  const triggers = [
    {
      id: "people",
      char: "@",
      items: [{ id: "user_ada", label: "Ada Lovelace", data: { type: "user" } }],
    },
  ];

  return (
    <ChatProvider controller={chat}>
      <ThreadPrimitive.Root>
        <ThreadPrimitive.Viewport>
          <ThreadPrimitive.Empty>Start a conversation.</ThreadPrimitive.Empty>
          <ThreadPrimitive.Suggestions />
          <ThreadPrimitive.Messages>
            <MessagePrimitive.Root>
              <MessagePrimitive.Content>
                <MessagePrimitive.Parts />
              </MessagePrimitive.Content>
              <MessagePrimitive.Actions />
            </MessagePrimitive.Root>
          </ThreadPrimitive.Messages>
          <ThreadPrimitive.Error />
          <ThreadPrimitive.ScrollToBottom>Jump to latest</ThreadPrimitive.ScrollToBottom>
        </ThreadPrimitive.Viewport>
        <ComposerPrimitive.Root triggers={triggers}>
          <ComposerPrimitive.Attachments />
          <ComposerPrimitive.AddAttachment>Attach</ComposerPrimitive.AddAttachment>
          <ComposerPrimitive.Input maxRows={6} placeholder="Send a message..." />
          <ComposerPrimitive.TriggerMenu />
          <ComposerPrimitive.Stop>Stop</ComposerPrimitive.Stop>
          <ComposerPrimitive.Submit>Send</ComposerPrimitive.Submit>
        </ComposerPrimitive.Root>
      </ThreadPrimitive.Root>
    </ChatProvider>
  );
}
```

The primitives are headless: pass `className` or `asChild` for design-system integration. Their
small semantic DOM contract consists of ARIA attributes, `data-state`, and `data-role`; there is no
package stylesheet. For editable, styled application components, run
`pnpm dlx @anvia/cli add chat`.

Control `ComposerPrimitive.Root` with `input`/`attachments` props when needed, and use
`submitMessage` for custom composer payloads. Use `keepMounted` on optional collections when empty
wrappers are useful for layout.

`ComposerPrimitive.Input` is a Tiptap-backed rich composer. Configure `ComposerPrimitive.Root` with `triggers` to
support inline `@`, `/`, `$`, or other entity chips; selected entities are submitted under
`metadata.composer.entities`. Entity `data` must be finite strict JSON; class instances, sparse or
custom-prototype arrays, accessors, symbols, cycles, `undefined`, and non-finite numbers are
rejected. Use `ComposerPrimitive.TextareaInput` when you need the previous native textarea behavior.

Streaming smoothing is opt-in and display-only. Keep `useChat` as the owner of transport and
`UIMessage[]` state. Keep the lifecycle mounted after streaming stops so its buffered tail drains;
`MessagePrimitive.Parts` also keeps later tool parts behind text that has not been revealed yet:

```tsx
<MessagePrimitive.Parts
  stream={{
    isStreaming:
      chat.status === "streaming" &&
      message.role === "assistant" &&
      chat.messages.at(-1)?.id === message.id,
    resetKey: message.id,
    flushImmediately: chat.status === "error",
  }}
>
  {(part) => (part.type === "text" ? <MessagePrimitive.Markdown /> : <MessagePrimitive.Part />)}
</MessagePrimitive.Parts>
```

For app-owned text state, `StreamMarkdown` is available from `@anvia/react-ui/stream`. It is a
context-free renderer: pass the already displayed text as `content` and set `live` only for its
growing tail. Style `[data-state="revealing"]` in the owning application; `@anvia/cli` installs this
animation with its `markdown`, `message`, `thread`, and `chat` items.
