# @anvia/server

Serve Anvia completions and Agent runs over HTTP. These framework-neutral response helpers turn
async events into streaming `Response` objects for Anvia clients, with JSONL, SSE, and replay support.

## Install

```sh
pnpm add @anvia/server @anvia/client @anvia/core @anvia/openai
```

The quickstart uses OpenAI; choose another provider adapter if needed.

## Quickstart

Set `OPENAI_API_KEY` on your server and mount this handler in a framework that accepts Web
`Request` and `Response` objects:

```ts
import { completionToClientStream, parseClientStreamRequest } from "@anvia/client";
import { streamCompletion } from "@anvia/core";
import { OpenAIClient } from "@anvia/openai";
import { createClientStreamResponse } from "@anvia/server";

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error("Set OPENAI_API_KEY.");
const model = new OpenAIClient({ apiKey }).completionModel({
  modelId: "gpt-5",
  api: "responses",
});

export async function POST(request: Request): Promise<Response> {
  const body = parseClientStreamRequest(await request.json());
  if (body.type !== "messages") {
    return new Response("This endpoint accepts messages only.", { status: 400 });
  }
  const events = completionToClientStream({
    events: streamCompletion({ model, messages: body.messages, abortSignal: request.signal }),
  });
  return createClientStreamResponse({ events });
}
```

Connect with `createHttpClientTransport` from `@anvia/client`, or use it with the `@anvia/react`
hooks. Add `format: "sse"` to the response options for SSE instead of the default JSONL.

## Capabilities

- Framed client responses with protocol headers and ordered event IDs.
- Resumable streams backed by a store you provide, with an in-memory store for local use.
- Separate generic event responses for application-defined protocols.
- Lower-level JSONL and SSE stream helpers.

Your application owns routing, authentication, request error handling, and durable storage.

## Learn more

- [Server streaming guide](https://github.com/anvia-hq/anvia/blob/main/docs/packages/server.md)
- [Client protocol](https://github.com/anvia-hq/anvia/tree/main/packages/client#readme)
- [React hooks](https://github.com/anvia-hq/anvia/tree/main/packages/react#readme)

## Durable execution routes

The optional `@anvia/server/durable` entrypoint exports `createDurableHandler` for
`@anvia/durable` runtimes. It provides submission, session-scoped run listing, snapshots,
SSE events with persisted IDs, queued steering, approval responses, retry, cancellation, and reconciliation.
`POST /durable/runs/:id/steer` accepts `{ input: { prompt } }` or `{ input: { messages } }`,
plus an optional `requestId`, and returns a persisted receipt with HTTP 202. It requires
authorization action `steer` and the matching durable release (0.8 or newer within the supported peer range).
An `authorize(request, resource)` callback is required for all reads and writes. The host
owns runtime startup (`resume`) and shutdown (`close`). Client disconnects detach observers.
Task submission requires `@anvia/durable` 0.6 or newer so authorization receives each effective
agent ID, including goal defaults and saved bindings. Older runtimes return HTTP 503 for task
submission; existing run routes remain available. No work is created when agent access is denied,
and a changed binding during authorization returns HTTP 409 for the caller to retry.

Install `@anvia/durable` when using this subpath. See the
[durable HTTP guide](../../docs/packages/durable.md#http-server-and-client).

Generic `SseStreamOptions` also supports `eventId(event)` for native SSE IDs and
`onCancel()` to interrupt a pending producer read before its iterator is returned.

Durable graph routes under `/durable/graphs` expose submission, paginated discovery, topology
snapshots, task SSE events, and cancellation. Graph-wide operations authorize every task;
individual child-run routes authorize against the graph's owning session. See the
[task graph guide](../../docs/packages/durable.md#task-dependencies-and-exposed-graphs).
