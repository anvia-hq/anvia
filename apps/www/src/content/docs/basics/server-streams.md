---
title: Server streams
description: Expose runtime streams from server routes with Anvia server helpers.
section: basics
sidebar:
  group: App integration
  order: 1
---

Use `@anvia/server` to return runtime streams from server routes.

## When to use this

Use server streams when a browser client should receive agent events over HTTP.

The server owns credentials and agent execution. The client receives normalized events.

## Return a stream response

```ts
import { createEventStream } from "@anvia/server";

export async function POST(request: Request) {
  const { input } = await request.json();

  return createEventStream(agent.prompt(input).stream(), {
    format: "jsonl",
  });
}
```

## Choose a format

JSONL is the default format and works well with Anvia React transports.

Use SSE when you need `text/event-stream` compatibility:

```ts
return createEventStream(agent.prompt(input).stream(), {
  format: "sse",
});
```

## What happens

`createEventStream` converts an async iterable of runtime events into a streaming `Response`.

## Next

Consume the stream from React.

[React client](/docs/basics/react-client)
