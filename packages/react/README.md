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
- `createFetchTransport(options)` creates an `EventTransport`.
- `createChatTransport(options)` creates the default fetch-backed chat transport.
- `useChat(options)` manages `UIMessage[]` chat state from any `EventTransport`.
- `useCompletion(options)` manages a single-turn `UIMessage[]` exchange and exposes derived `completion` text.

Default hook requests use one shared wire shape:

```ts
type UIStreamRequest = {
  messages: UIMessage[];
  stream: true;
};
```

The shared boundary is:

```ts
type EventTransport<TRequest, TEvent> = {
  send(request: TRequest, options?: TransportOptions): AsyncIterable<TEvent>;
};
```
