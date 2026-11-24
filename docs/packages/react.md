# @anvia/react guide

[Package overview](../../packages/react/README.md)

React controllers and composable, headless React UI primitives for the explicit `@anvia/client` stream protocol.

```tsx
import { createHttpClientTransport, type UIMessage } from "@anvia/client";
import { useChat } from "@anvia/react";

const transport = createHttpClientTransport({ endpoint: "/api/chat" });

export function Chat() {
  const chat = useChat({ transport });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void chat.sendMessage({ text: "Hello" });
      }}
    >
      {chat.messages.map((message: UIMessage) => (
        <div key={message.id}>
          {message.parts
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join("")}
        </div>
      ))}
      <button disabled={chat.status === "submitted" || chat.status === "streaming"}>Send</button>
    </form>
  );
}
```

`useChat` and `useCompletion` require an explicit transport boundary:

```ts
import {
  createDirectClientTransport,
  createHttpClientTransport,
  type ClientCompletionRequest,
} from "@anvia/client";
import { useChat, useCompletion } from "@anvia/react";

const transport = createHttpClientTransport({ endpoint: "/api/chat" });
useChat({ transport });

const completionTransport = createHttpClientTransport<ClientCompletionRequest>({
  endpoint: "/api/completion",
});
useCompletion({ transport: completionTransport });

useChat({
  transport: createDirectClientTransport({
    handler: ({ request, abortSignal }) => handleChat({ request, abortSignal }),
  }),
});
```

Import transports, protocol types, `UIMessage`, and conversion helpers from `@anvia/client`.
`@anvia/react` deliberately does not re-export them.
Import Agent interaction types directly from `@anvia/core/agent/interactions` when an application
needs to name them.

`useChat`:

- consumes only framed `ClientStreamFrame` values;
- exposes `ready | submitted | streaming | waiting | error` status;
- keeps readonly `UIMessage[]` locally and sends core `Message[]` in `ClientStreamRequest`;
- exposes canonical events through `onEvent` and the returned `events` array;
- exposes aggregate usage for the latest run through `runUsage`, while each assistant message
  retains its own provider-generation usage;
- supports optional resumable streams and unified Agent interaction state.

The default request is:

```ts
type ClientStreamRequest =
  | {
      type: "messages";
      messages: readonly Message[];
      metadata?: JsonObject;
      resume?: { streamId: string; after: number };
    }
  | {
      type: "interaction_response";
      interactionId: string;
      response: AgentInteractionResponse;
      metadata?: JsonObject;
      resume?: { streamId: string; after: number };
    };
```

When `chat.status === "waiting"`, render `chat.interactions.pending` and resume through the same
transport boundary:

```ts
await chat.respondToInteraction({
  interactionId,
  response: { type: "tool-approval", approved: true },
});
```

The browser never receives an `AgentContinuation`; the server retains and atomically claims it by
interaction ID.

For resumable chat, pair `useChat({ transport, resume: { key } })` with
`createClientStreamResponse({ events, resumable })` and `resumeClientStreamResponse(...)` on the
server.

`useCompletion({ transport: completionTransport })` is a genuine single-turn controller. Call
`complete({ prompt })`, or manage `input` and call `submit()`. Each call replaces the previous
completion, events, and `usage`; it never exposes or accumulates chat messages.

`useSmoothStreamText` and `useSmoothStreamItems` only smooth presentation. They do not change
protocol events or message state.

## Headless UI primitives

Composable, headless React UI primitives for Anvia applications live alongside the hooks in
`@anvia/react`.

```tsx
import { createHttpClientTransport } from "@anvia/client";
import {
  ChatProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useChat,
} from "@anvia/react";

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
rejected. Pass `renderEntity={(entity) => <Chip {...entity} />}` to change how a token displays in the
editor (for example an avatar or display name from `entity.data`); the saved text and entities are
unchanged, and returning `null` or `undefined` falls back to `entity.text`. Keep `renderEntity` a
pure function of `entity`: a token re-renders only when its node changes, not when state the function
closes over changes. Use `ComposerPrimitive.TextareaInput` when you need the previous native textarea behavior.

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

For app-owned text state, `StreamMarkdown` is available from `@anvia/react/stream`. It is a
context-free renderer: pass the already displayed text as `content` and set `live` only for its
growing tail. Style `[data-state="revealing"]` in the owning application; `@anvia/cli` installs this
animation with its `markdown`, `message`, `thread`, and `chat` items.

## Graph explorer

`@anvia/react/graph-explorer` owns graph exploration behavior and supplies optional headless
composition primitives without choosing a layout or rendering library. Provide
a browser-safe `explore` callback, normally backed by an application HTTP route, then render the
controller's nodes and relationships with React Flow, Sigma.js, SVG, canvas, or any other renderer:

```tsx
import type { GraphExplorer } from "@anvia/graph";
import {
  GraphExplorerNodePrimitive,
  GraphExplorerPrimitive,
  GraphExplorerProvider,
  useGraphExplorer,
} from "@anvia/react/graph-explorer";

export function KnowledgeGraph({ explore }: { explore: GraphExplorer["explore"] }) {
  const controller = useGraphExplorer({ explore });
  return (
    <GraphExplorerProvider controller={controller}>
      <GraphExplorerPrimitive.Root>
        <GraphExplorerPrimitive.Search />
        <GraphExplorerPrimitive.Viewport>
          {controller.nodes.map((node) => (
            <GraphExplorerNodePrimitive.Root key={node.id} nodeId={node.id} asChild>
              {/* This can instead be an element supplied to a renderer such as React Flow. */}
              <article>{node.type}</article>
            </GraphExplorerNodePrimitive.Root>
          ))}
        </GraphExplorerPrimitive.Viewport>
        <GraphExplorerPrimitive.Empty />
        <GraphExplorerPrimitive.Status />
      </GraphExplorerPrimitive.Root>
    </GraphExplorerProvider>
  );
}
```

Call `controller.explore({ mode: "overview" })` to load an initial view. Overview results replace the
current graph; expansion results merge by opaque node and relationship IDs. Starting a request
aborts the previous request, while `refresh()` repeats the latest overview with a fresh signal.
Expansions inherit filters and limits from the latest successful overview unless explicitly
overridden. `matchedNodeIds` lets renderers dim, hide, or highlight local search results without
prescribing one visual behavior. Validate data returned by an HTTP route before resolving the
`explore` callback; the headless controller intentionally trusts its typed boundary. Renderers that
do not expose React elements for individual nodes can consume the controller directly without the
node primitives.

`MessagePrimitive.Actions` displays its action group only for the final assistant message in each user exchange, after streaming completes. Earlier completed replies retain their actions. Use `MessagePrimitive.Copy` or `MessagePrimitive.Regenerate` directly when composing custom action visibility.

## Sandbox terminal

`@anvia/react/sandbox-terminal` draws an interactive terminal for a remote sandbox session with
[xterm.js](https://xtermjs.org). It talks to the browser relay of `RemoteSandboxHub` (see
[Terminals](./tool-sandbox.md#terminals)). Install the optional peers `@xterm/xterm` and
`@xterm/addon-fit`, and import xterm's stylesheet once. xterm is loaded on demand when the first
terminal mounts, and the component lives on its own subpath so apps that never show a terminal never
load it.

```tsx
import "@xterm/xterm/css/xterm.css";
import { SandboxTerminal } from "@anvia/react/sandbox-terminal";

export function Terminal({ sandboxId }: { sandboxId: string }) {
  return (
    <div style={{ height: 420 }}>
      <SandboxTerminal
        url="/terminal"
        sessionName="main"
        // Single-use, so pass a function: every reconnect fetches a fresh one.
        ticket={async () => (await fetch(`/api/sandboxes/${sandboxId}/terminal-ticket`)).text()}
      />
    </div>
  );
}
```

The component fills its parent, so give the parent a height. It refits with a `ResizeObserver` and
sends the new size to the sandbox.

| Prop              | Purpose                                                                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `url`             | The hub's terminal endpoint: `ws:`/`wss:`, `http:`/`https:`, or a path on this page.                                                              |
| `ticket`          | A short-lived ticket or a function returning one. It travels as the `anvia.ticket.<ticket>` subprotocol, so it must use only URL-safe characters. |
| `sessionName`     | Sent as `?session=`. Your `authorizeTerminal` may use it; the server decides which session a ticket grants.                                       |
| `readOnly`        | Output only. The terminal takes no input, and the server enforces it as well.                                                                     |
| `reconnect`       | `{ initialDelayMs, maxDelayMs, maxAttempts }`. Defaults are 500 ms, 15 s and 10 attempts.                                                         |
| `terminalOptions` | xterm options such as `fontSize` or `theme`, applied when the terminal is created.                                                                |
| `onStatusChange`  | Called with every connection state change.                                                                                                        |
| `renderStatus`    | Replace the default status line.                                                                                                                  |

A connection is `loading`, `connecting`, `open`, `reconnecting`, `ended` (the shell exited; no
reconnect) or `failed` (a fatal error or the attempts ran out). The root element carries the state
as `data-state`, and the default status line is a `role="status"` element in its corner that offers
a Retry button after a failure. After a reconnect the screen is cleared before the session redraws.
Changing `url`, `sessionName` or `readOnly` reconnects; other props are read when they are needed.
A `ref` exposes `focus()` and `reconnect()`.

The component does not choose who may see a session. That is the job of the ticket your backend
mints and the hub's `authorizeTerminal`, including the `readOnly` grant.

## Sandbox desktop

`@anvia/react/sandbox-desktop` shows a remote sandbox's desktop with [noVNC](https://novnc.com)
and lets a person take control from the agent. It talks to the desktop relay of `RemoteSandboxHub`
(see [Desktop](./tool-sandbox.md#desktop)). Install the optional peer `@novnc/novnc`. noVNC is
loaded on demand when the first desktop mounts, and the component lives on its own subpath so apps
that never show a desktop never load it. noVNC is licensed MPL-2.0; it is a peer dependency, so
your application bundles it, not this package.

```tsx
import { SandboxDesktop } from "@anvia/react/sandbox-desktop";

export function Desktop({ sandboxId }: { sandboxId: string }) {
  return (
    <div style={{ height: 600 }}>
      <SandboxDesktop
        url="/desktop"
        // Single-use, so pass a function: every reconnect fetches a fresh one.
        ticket={async () => (await fetch(`/api/sandboxes/${sandboxId}/desktop-ticket`)).text()}
      />
    </div>
  );
}
```

The component fills its parent, so give the parent a height, and scales the desktop to fit it
(`scaleToFit={false}` shows it at its own size). The desktop's size is set through the hub's API
(`desktop.resize`); a viewer never resizes it.

**Smoothness.** Everything that crosses the link is compressed pixels, so size and the two levels are
what you tune. 1280x800 (the daemon's default) is a good size; going past 1440x900 costs the server
CPU and the link bandwidth for little the agent or a person can use, and a screenshot is scaled to
fit the model's image limits anyway. On a slow or distant link lower `qualityLevel` (to 3 or 4) and
raise `compressionLevel` (to 5 or more); on a fast one the defaults are right. Over a long link,
make sure the desktop is opened through `desktop.openViewer()` or the hub's desktop relay, which ask
for the `interactive` tunnel profile, since the default tunnel window caps throughput near 2.6 MB/s
at 100 ms.

| Prop                                | Purpose                                                                                                                                           |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `url`                               | The hub's desktop endpoint: `ws:`/`wss:`, `http:`/`https:`, or a path on this page.                                                               |
| `ticket`                            | A short-lived ticket or a function returning one. It travels as the `anvia.ticket.<ticket>` subprotocol, so it must use only URL-safe characters. |
| `readOnly`                          | Watch only. The relay enforces it too: it removes a read-only viewer's key, pointer and clipboard messages.                                       |
| `scaleToFit`                        | Scale the desktop to the element. Default true.                                                                                                   |
| `qualityLevel`, `compressionLevel`  | What the viewer asks the server for, each 0 to 9: JPEG quality (default 6) and compression (default 2). They apply to the live connection.        |
| `reconnect`                         | `{ initialDelayMs, maxDelayMs, maxAttempts }`. Defaults are 500 ms, 15 s and 10 attempts.                                                         |
| `onStatusChange`, `onControlChange` | Called when the connection state changes, and when the relay reports who has control.                                                             |
| `renderStatus`, `renderControls`    | Replace the default status line and take-over bar.                                                                                                |

**Taking control.** The default bar shows who is driving: "The agent has control", "alice has
control", "You have control" or "View only". "Take over" asks the relay for control, which pauses
the agent's inputs (they fail with `desktop_locked`) until "Release". The viewer is watch-only
until it holds control, so a person's input never mixes with the agent's; while someone else holds
control it also has no take-over button. Closing the tab releases control. `renderControls` receives `{ status,
control, readOnly, notice, takeOver, release }` to draw your own, and a `ref` exposes `focus()`,
`reconnect()`, `takeOver()` and `release()`. A request that fails, such as taking over while someone
else holds control, shows as `notice` until the next update.

A connection is `loading`, `connecting`, `open`, `reconnecting` or `failed`, as for the
[terminal](#sandbox-terminal), and the root element carries it as `data-state` (and `data-control`
as `you`, `other` or `none`). A relay that cannot set the viewer up closes with a reason like
`unsupported: ...`; the viewer shows it and stops when retrying cannot help, and retries when the
sandbox may just be starting. Each reconnect gets a new noVNC client and a fresh ticket.

Both viewers share one connection implementation: reconnect with backoff, a fresh ticket per
attempt, and the same status line.
