# @anvia/react

React hooks and client transports for Anvia applications.

```tsx
import { useChat } from "@anvia/react";
import { useState } from "react";

export function Chat() {
  const chat = useChat({ endpoint: "/api/chat" });
  const [input, setInput] = useState("");

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void chat.sendMessage(input);
        setInput("");
      }}
    >
      <div>
        {chat.messages.map((message) => (
          <p key={message.id}>
            {message.parts
              .filter((part) => part.type === "text")
              .map((part) => part.text)
              .join("")}
          </p>
        ))}
      </div>
      <input value={input} onChange={(event) => setInput(event.target.value)} />
      <button disabled={chat.status === "streaming"}>Send</button>
    </form>
  );
}
```

## Exports

- `readJsonlStream(stream)` parses newline-delimited JSON streams.
- `readSseStream(stream)` parses Server-Sent Events with JSON `data:` payloads.
- `fetchEventStream(url, options)` fetches JSONL or SSE streams as `AsyncIterable`.
- `createFetchTransport(options)` creates an `EventTransport`; it defaults to POST JSON and omits implicit bodies for GET/HEAD.
- `createChatTransport(options)` creates the default fetch-backed chat transport.
- `useChat(options)` manages `UIMessage[]` chat state from any `EventTransport`, including optional human-input approval/question state.
- `useCompletion(options)` appends completion turns into `UIMessage[]` state and exposes derived `completion` text.

Default hook requests use one shared wire shape:

```ts
type UIStreamRequest = {
  messages: Message[];
  stream: true;
  metadata?: JsonValue;
};
```

Hooks convert their local `UIMessage[]` state into core messages before sending. Custom
`createRequest` callbacks receive `{ messages, uiMessages, coreMessages }`, where `messages` and
`uiMessages` are UI-shaped for compatibility and `coreMessages` is the default wire payload.

The shared boundary is:

```ts
type EventTransport<TRequest, TEvent> = {
  send(request: TRequest, options?: TransportOptions): AsyncIterable<TEvent>;
};
```

Default hooks can consume raw `createCompletionStream(...)` events, raw agent stream events, or
`UIStreamEvent` records. A completion endpoint can return:

```ts
createEventStream(createCompletionStream(model, { messages: body.messages }));
```
