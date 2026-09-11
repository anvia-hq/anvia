---
name: anvia-chat
description: Wire an Anvia chat UI end to end — server stream route, client transport, React hook, and UI primitives.
---

# Anvia Chat Skill

Use this skill when the user wants a chat or completion UI backed by Anvia:
new chat routes, transports, `useChat`/`useCompletion` wiring, message rendering,
resumable streams, agent tool-approval interactions, or `anvia add chat` work.

## Process

1. Build the server route first (`references/server-protocol.md`).
2. Pick the transport and state conversions (`references/transports-state.md`).
3. Wire the React controller and render UI primitives (`references/react-ui.md`).
4. Run `scripts/check-chat-boundary.sh` from the app root before claiming done.

## Minimal slice

```ts
// Server route: core events -> client protocol -> framed response.
import { completionToClientStream, parseClientStreamRequest } from "@anvia/client";
import { streamCompletion } from "@anvia/core";
import { createClientStreamResponse } from "@anvia/server";

const body = parseClientStreamRequest(await request.json());
if (body.type !== "messages") throw new Error("This completion endpoint accepts messages only.");
const events = completionToClientStream({
  events: streamCompletion({ model, messages: body.messages }),
});
return createClientStreamResponse({ events }); // JSONL by default
```

```tsx
// App: explicit transport, hook owns state, primitives render it.
import { createHttpClientTransport } from "@anvia/client";
import { useChat } from "@anvia/react";
import { ChatProvider, ComposerPrimitive, ThreadPrimitive } from "@anvia/react-ui";

const transport = createHttpClientTransport({ endpoint: "/api/chat" });
const chat = useChat({ transport });

<ChatProvider controller={chat}>
  <ThreadPrimitive.Root>
    <ThreadPrimitive.Viewport>
      <ThreadPrimitive.Messages />
    </ThreadPrimitive.Viewport>
    <ComposerPrimitive.Root>
      <ComposerPrimitive.Input placeholder="Send a message..." />
      <ComposerPrimitive.Submit>Send</ComposerPrimitive.Submit>
    </ComposerPrimitive.Root>
  </ThreadPrimitive.Root>
</ChatProvider>;
```

## Output

Keep the answer to the smallest working vertical slice: one route, one transport,
one hook, one render tree. Point to the relevant reference file instead of
pasting its contents into chat.
