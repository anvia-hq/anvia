# @anvia/react

React controllers for the explicit `@anvia/client` stream protocol.

```tsx
import type { UIMessage } from "@anvia/client";
import { useChat } from "@anvia/react";

export function Chat() {
  const chat = useChat({ endpoint: "/api/chat" });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void chat.sendMessage("Hello");
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

`useChat` and `useCompletion` require exactly one connection boundary:

```ts
useChat({ endpoint: "/api/chat" });

useChat({
  transport: createDirectClientTransport(async (request) => handleChat(request)),
});
```

Import transports, protocol types, `UIMessage`, and conversion helpers from `@anvia/client`.
`@anvia/react` deliberately does not re-export them.

Both hooks:

- consume only framed `ClientStreamFrame` values;
- expose `ready | submitted | streaming | error` status;
- keep `UIMessage[]` locally and send core `Message[]` in `ClientStreamRequest`;
- accept a custom `createRequest({ uiMessages, messages, resume })` for endpoint-specific request
  types;
- expose canonical events through `onEvent` and the returned `events` array;
- support optional resumable streams and tool approval/question state.

The default request is:

```ts
type ClientStreamRequest = {
  messages: Message[];
  metadata?: JsonValue;
  resume?: { streamId: string; after: number };
};
```

For resumable chat, pair `useChat({ endpoint, resume: { key } })` with
`createClientStreamResponse(..., { resumable })` and `resumeClientStreamResponse(...)` on the
server.

`useSmoothStreamText` and `useSmoothStreamItems` only smooth presentation. They do not change
protocol events or message state.
