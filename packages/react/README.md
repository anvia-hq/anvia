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

`useChat`:

- consumes only framed `ClientStreamFrame` values;
- exposes `ready | submitted | streaming | error` status;
- keeps readonly `UIMessage[]` locally and sends core `Message[]` in `ClientStreamRequest`;
- exposes canonical events through `onEvent` and the returned `events` array;
- supports optional resumable streams and tool approval/question state.

The default request is:

```ts
type ClientStreamRequest = {
  messages: readonly Message[];
  metadata?: JsonObject;
  resume?: { streamId: string; after: number };
};
```

For resumable chat, pair `useChat({ transport, resume: { key } })` with
`createClientStreamResponse({ events, resumable })` and `resumeClientStreamResponse(...)` on the
server.

`useCompletion({ transport })` is a genuine single-turn controller. Call
`complete({ prompt })`, or manage `input` and call `submit()`. Each call replaces the previous
completion, events, and usage; it never exposes or accumulates chat messages.

`useSmoothStreamText` and `useSmoothStreamItems` only smooth presentation. They do not change
protocol events or message state.
