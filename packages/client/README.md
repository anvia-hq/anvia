# @anvia/client

Connect any frontend to Anvia with a framework-neutral streaming protocol. This package provides
HTTP and direct transports, runtime validation, and UI message state for text, tools, and interactions.

## Install

```sh
pnpm add @anvia/client @anvia/core
```

## Quickstart

Consume a chat endpoint that returns an Anvia client stream, such as one created with
`@anvia/server`:

```ts
import {
  applyClientStreamEvent,
  createHttpClientTransport,
  messagesToUIMessages,
  type UIMessage,
} from "@anvia/client";
import type { Message } from "@anvia/core/completion";

const transport = createHttpClientTransport({ endpoint: "/api/chat" });
const messages: Message[] = [{ role: "user", content: "Hello!" }];
let uiMessages: readonly UIMessage[] = messagesToUIMessages(messages);

for await (const frame of transport.send({ request: { type: "messages", messages } })) {
  if (frame.type === "stream_event") {
    uiMessages = applyClientStreamEvent(uiMessages, frame.event);
    console.log(uiMessages);
  }
}
```

The transport validates framing, event order, and stream identity. Send Core `Message[]` to the
server; keep `UIMessage[]` as presentation state in your application.

## Capabilities

- HTTP transport for JSONL or SSE, plus direct transport for in-process integrations.
- Adapters for native completion and Agent events at the server boundary.
- Validated requests, events, frames, and persisted UI messages.
- Message conversion and reduction, including streamed tool arguments and generation usage.
- Typed custom stream data, Agent interactions, and HTTP resume cursors.

For React, `@anvia/react` manages this state through `useChat` and `useCompletion`. Generic JSONL/SSE
readers are also available from `@anvia/client/transport` for other event contracts.

## Learn more

- [Client protocol guide](https://github.com/anvia-hq/anvia/blob/main/docs/packages/client.md)
- [Server response helpers](https://github.com/anvia-hq/anvia/tree/main/packages/server#readme)
- [React hooks](https://github.com/anvia-hq/anvia/tree/main/packages/react#readme)
