# @anvia/react

Build streaming chat and completion experiences with React hooks. Anvia manages message state,
request status, cancellation, usage, and Agent interactions while you choose the UI and transport.

## Install

```sh
pnpm add @anvia/react @anvia/client @anvia/core react
```

Requires React 18 or newer.

## Quickstart

Point the transport at an application endpoint that returns an Anvia client stream:

```tsx
import { createHttpClientTransport } from "@anvia/client";
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
      {chat.messages.map((message) => (
        <div key={message.id}>
          {message.parts
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join("")}
        </div>
      ))}
      <button disabled={chat.status !== "ready"}>Send hello</button>
      {chat.error && <p role="alert">{chat.error.message}</p>}
    </form>
  );
}
```

Use `@anvia/server` to create the matching response on your server. Provider credentials and Agent
continuations stay on the server.

## Hooks and helpers

- `useChat`: conversation state, streaming, cancellation, usage, approvals, questions, and resume.
- `useCompletion`: single-turn text generation with its own input and completion state.
- `useSmoothStreamText` and `useSmoothStreamItems`: optional presentation smoothing.
- `initialMessagesFromMemory`: convert stored Core messages into initial UI state.
- `useGraphExplorer` from `@anvia/react/graph-explorer`: search and expand graph data with your own
  renderer; install `@anvia/graph` when using this optional integration.

## Learn more

- [React guide](https://github.com/anvia-hq/anvia/blob/main/docs/packages/react.md)
- [Headless UI components](https://github.com/anvia-hq/anvia/tree/main/packages/react-ui#readme)
- [Server response helpers](https://github.com/anvia-hq/anvia/tree/main/packages/server#readme)
