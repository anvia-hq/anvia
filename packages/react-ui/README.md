# @anvia/react-ui

Compose AI chat interfaces with headless React primitives. Bring your own design system for threads,
messages, rich composition, attachments, approvals, and questions.

## Install

```sh
pnpm add @anvia/react-ui @anvia/react @anvia/client @anvia/core react react-dom
```

Requires React and React DOM 18 or newer. For editable, styled components, use
`pnpm dlx @anvia/cli ui add chat` in an application configured with shadcn.

## Quickstart

Connect a chat controller to your application's Anvia streaming endpoint:

```tsx
import { createHttpClientTransport } from "@anvia/client";
import { useChat } from "@anvia/react";
import {
  ChatProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
} from "@anvia/react-ui";

const transport = createHttpClientTransport({ endpoint: "/api/chat" });

export function SupportChat() {
  const chat = useChat({ transport });
  return (
    <ChatProvider controller={chat}>
      <ThreadPrimitive.Root>
        <ThreadPrimitive.Viewport>
          <ThreadPrimitive.Empty>Start a conversation.</ThreadPrimitive.Empty>
          <ThreadPrimitive.Messages>
            <MessagePrimitive.Root>
              <MessagePrimitive.Content>
                <MessagePrimitive.Parts />
              </MessagePrimitive.Content>
              <MessagePrimitive.Actions />
            </MessagePrimitive.Root>
          </ThreadPrimitive.Messages>
          <ThreadPrimitive.Error />
        </ThreadPrimitive.Viewport>
        <ComposerPrimitive.Root>
          <ComposerPrimitive.Input placeholder="Send a message..." />
          <ComposerPrimitive.Stop>Stop</ComposerPrimitive.Stop>
          <ComposerPrimitive.Submit>Send</ComposerPrimitive.Submit>
        </ComposerPrimitive.Root>
      </ThreadPrimitive.Root>
    </ChatProvider>
  );
}
```

Style primitives with `className`, or use `asChild` to compose your own elements. The package ships
semantic attributes and behavior; it has no package stylesheet.

## Capabilities

- Threads, message parts, Markdown, attachments, and message actions.
- Rich text composition with inline entity triggers and an optional native textarea.
- Approval and question controls, completion UI, thread lists, and context meters.
- Images, selection toolbars, and optional streaming presentation smoothing.
- Graph exploration primitives through `@anvia/react-ui/graph-explorer`; install `@anvia/graph`
  when using that integration.

## Learn more

- [UI composition guide](https://github.com/anvia-hq/anvia/blob/main/docs/packages/react-ui.md)
- [React controllers](https://github.com/anvia-hq/anvia/tree/main/packages/react#readme)
- [Editable components CLI](https://github.com/anvia-hq/anvia/tree/main/packages/cli#readme)
