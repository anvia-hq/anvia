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

## Prerequisites

Install `@anvia/server` and keep provider credentials on the server. The examples assume an `agent` created by the previous steps.

## Return a stream response

```ts
import type { UIStreamRequest } from "@anvia/core";
import { createEventStream } from "@anvia/server";

export async function POST(request: Request) {
  const body = (await request.json()) as UIStreamRequest;

  return createEventStream(agent.prompt(body.messages).stream(), {
    format: "jsonl",
  });
}
```

## Choose a format

JSONL is the default format and works well with Anvia React transports.

Use SSE when you need `text/event-stream` compatibility:

```ts
return createEventStream(agent.prompt(body.messages).stream(), {
  format: "sse",
});
```

## What happens

`createEventStream` converts an async iterable of runtime events into a streaming `Response`.

React clients send the default request shape `{ messages, stream: true }`. If your route is meant
for `@anvia/react` or `@anvia/react-ui`, read `body.messages`, not a single `{ message }` string.

## Check yourself

Call the route and confirm the response streams JSONL events. The browser client should not need direct access to provider credentials.

## Next

Consume the stream from React.

[React client](/docs/basics/react-client)
