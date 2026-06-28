---
title: Fullstack Streaming
description: A minimal server and React flow for streaming completions and agents into UI messages.
section: examples
sidebar:
  group: Workflow Patterns
  order: 2
---

Fullstack streaming connects a browser UI to server-owned model and agent execution. The browser keeps `UIMessage[]` state. The React hooks send converted core `Message[]` requests, and the server returns JSONL runtime events.

Use this shape when you want to test direct completion streaming and agent streaming from the same frontend before adding auth, persistence, tools, or trace storage.

## Scenario

A local React app needs two panels:

- completion: one direct model stream through `createCompletionStream(...)`
- agent: one reusable agent stream through `agent.prompt(messages).stream()`

Both panels should append into message state and show the same UI message structure.

## Flow

| Step | Owner |
| --- | --- |
| keep `UIMessage[]` state | React hook |
| convert and send `{ messages, stream: true }` | `@anvia/react` |
| run model or agent | server route |
| return JSONL events | `@anvia/server` |
| reduce events back into `UIMessage[]` | `@anvia/react` |

## Server

This example uses Hono because it keeps the routes small. The same handlers work in any server framework that can return a `Response`.

```ts
import { AgentBuilder, createCompletionStream } from "@anvia/core";
import type { UIStreamRequest } from "@anvia/core/ui";
import { OpenAIClient } from "@anvia/openai";
import { createEventStream } from "@anvia/server";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import "dotenv/config";

const instructions = "Answer clearly and concisely.";

const client = new OpenAIClient({
  apiKey: process.env.OPENAI_API_KEY,
});

const model = client.completionModel("gpt-5");
const agent = new AgentBuilder("assistant", model)
  .instructions(instructions)
  .maxTokens(500)
  .build();

const app = new Hono()
  .use(cors())
  .get("/", (c) => c.json({ ok: true }))
  .post("/completion", async (c) => {
    const body = (await c.req.json()) as UIStreamRequest;

    return createEventStream(
      createCompletionStream(model, {
        instructions,
        messages: body.messages,
        maxTokens: 500,
      }),
      { format: "jsonl" },
    );
  })
  .post("/agent", async (c) => {
    const body = (await c.req.json()) as UIStreamRequest;

    return createEventStream(agent.prompt(body.messages).stream(), {
      format: "jsonl",
    });
  });

serve({
  fetch: app.fetch,
  port: Number(process.env.PORT ?? 8000),
});
```

The request body is the default React wire shape:

```ts
type UIStreamRequest = {
  messages: Message[];
  stream: true;
  metadata?: JsonValue;
};
```

## React Client

Use `useCompletion` for the direct completion route and `useChat` for the agent route. Both hooks expose `messages`, `status`, `stop`, and reset behavior around the same UI message state.

```tsx
import { useChat, useCompletion } from "@anvia/react";
import { useState } from "react";

const apiUrl = "http://localhost:8000";

export function App() {
  const completion = useCompletion({
    endpoint: `${apiUrl}/completion`,
    format: "jsonl",
  });
  const agent = useChat({
    endpoint: `${apiUrl}/agent`,
    format: "jsonl",
  });
  const [agentInput, setAgentInput] = useState("");

  return (
    <main>
      <section>
        <h2>Completion</h2>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void completion.complete();
          }}
        >
          <textarea
            value={completion.input}
            onChange={(event) => completion.setInput(event.target.value)}
          />
          <button disabled={completion.status === "streaming"}>Send</button>
          <button type="button" onClick={completion.stop}>
            Stop
          </button>
          <button type="button" onClick={() => completion.reset()}>
            Reset
          </button>
        </form>
        <p>Status: {completion.status}</p>
        <pre>{JSON.stringify(completion.messages, null, 2)}</pre>
      </section>

      <section>
        <h2>Agent</h2>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void agent.sendMessage(agentInput);
            setAgentInput("");
          }}
        >
          <textarea
            value={agentInput}
            onChange={(event) => setAgentInput(event.target.value)}
          />
          <button disabled={agent.status === "streaming"}>Send</button>
          <button type="button" onClick={agent.stop}>
            Stop
          </button>
          <button type="button" onClick={() => agent.reset()}>
            Reset
          </button>
        </form>
        <p>Status: {agent.status}</p>
        <pre>{JSON.stringify(agent.messages, null, 2)}</pre>
      </section>
    </main>
  );
}
```

## What To Look For

`useCompletion.complete()` appends each prompt into the current message state. The completion server receives the full converted core message history on each request.

`useChat.sendMessage()` does the same for the agent route. Raw agent stream events are reduced into assistant message parts. Text appears as `type: "text"`, reasoning appears as `type: "reasoning"`, and tool calls appear as `type: "tool"`.

An agent tool call becomes part of the assistant message:

```ts
{
  id: "tool_tool_1",
  type: "tool",
  toolName: "lookup_order",
  toolCallId: "tool_1",
  callId: "call_1",
  state: "output-available",
  input: { orderId: "A-100" },
  output: { status: "shipped" }
}
```

The agent final event adds run metadata to the assistant message:

```ts
{
  role: "assistant",
  parts: [{ type: "text", text: "Order A-100 has shipped." }],
  metadata: { runId: "run_123" }
}
```

## Next Patterns

- [Streaming Events](/docs/examples/streaming-events) for filtering and persisting runtime events.
- [Runtime State and Persistence](/docs/examples/runtime-state-persistence) for storing messages, events, traces, and run records.
- [Agent App Flow](/docs/examples/agent-app-flow) for adding auth, tools, memory, and product persistence around the stream.
