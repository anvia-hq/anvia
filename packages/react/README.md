# @anvia/react

Build streaming chat, completion, and agent interfaces with React hooks and composable, headless UI
primitives. Anvia manages message state, request status, cancellation, usage, and Agent interactions
while you choose your design system and transport.

## Install

```sh
pnpm add @anvia/react @anvia/client @anvia/core react react-dom
```

Requires React 18 or newer (`react-dom` is optional if you only use hooks without portal primitives).
For editable, styled components, use `pnpm dlx @anvia/cli ui add chat` in an application configured
with shadcn.

## Quickstart

Point the transport at an application endpoint that returns an Anvia client stream:

```tsx
import { createHttpClientTransport } from "@anvia/client";
import {
  ChatProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useChat,
} from "@anvia/react";

const transport = createHttpClientTransport({ endpoint: "/api/chat" });

export function Chat() {
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
semantic attributes and behavior; it has no package stylesheet. Use `@anvia/server` to create the
matching response on your server. Provider credentials and Agent continuations stay on the server.

## Hooks and primitives

- **Controllers & hooks:** `useChat`, `useDurableChat`, `useCompletion`, `useSmoothStreamText`,
  `useSmoothStreamItems`, and `initialMessagesFromMemory`.
- **Headless UI primitives:** `ChatProvider`, `ThreadPrimitive`, `ComposerPrimitive`,
  `MessagePrimitive`, `AttachmentPrimitive`, `HumanInputPrimitive`, `CompletionPrimitive`,
  `ThreadListPrimitive`, `ImagePrimitive`, `SelectionToolbarPrimitive`, `ContextMeterPrimitive`,
  and `StreamMarkdown`.
- **Graph explorer (`@anvia/react/graph-explorer`):** `useGraphExplorer`, `GraphExplorerProvider`,
  `GraphExplorerPrimitive`, and `GraphExplorerNodePrimitive`; install `@anvia/graph` when using
  this optional integration.
- **Remote sandbox viewers:** `@anvia/react/sandbox-terminal` (install `@xterm/xterm` and
  `@xterm/addon-fit`) and `@anvia/react/sandbox-desktop` (install `@novnc/novnc`).

## Learn more

- [React guide](https://github.com/anvia-hq/anvia/blob/main/docs/packages/react.md)
- [Editable components CLI](https://github.com/anvia-hq/anvia/tree/main/packages/cli#readme)
- [Server response helpers](https://github.com/anvia-hq/anvia/tree/main/packages/server#readme)
