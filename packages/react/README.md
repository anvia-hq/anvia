# @anvia/react

React controllers for the explicit `@anvia/client` stream protocol.

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
const transport = createHttpClientTransport({ endpoint: "/api/chat" });
useChat({ transport });

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

`useCompletion({ transport })` is a genuine single-turn controller. Call
`complete({ prompt })`, or manage `input` and call `submit()`. Each call replaces the previous
completion, events, and usage; it never exposes or accumulates chat messages.

`useSmoothStreamText` and `useSmoothStreamItems` only smooth presentation. They do not change
protocol events or message state.
