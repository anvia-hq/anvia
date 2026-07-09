---
title: Resumable streams
description: Recover chat streams after navigation, reloads, and dropped browser connections.
section: advanced
sidebar:
  group: Agent runtime
  order: 20
  label: Resume
---

Resumable streams let a browser recover a running chat stream after navigation, reload, or a
temporary connection drop. The model or agent keeps running on the server, emitted events are stored
with ordered cursors, and the client reconnects to the same endpoint with the last event it saw.

This is not a WebSocket requirement. The important parts are a stable stream id, ordered event ids,
server-side replay, and client-side cursor persistence. Anvia provides the stream envelope and React
bookkeeping; your application still owns authentication, durable storage, worker ownership, and
retention.

## End-To-End Shape

Use one POST route for both starting and resuming:

```ts
type ChatBody = UIStreamRequest & {
  resume?: {
    streamId: string;
    after: number;
  };
};
```

When `resume` is missing, start a new run and return a resumable event stream. When `resume` is
present, replay stored events after `after` and then tail live events until the stream ends.

The wire response is wrapped in resumable envelopes:

```json
{"type":"stream_start","streamId":"run_123","eventId":0}
{"type":"stream_event","streamId":"run_123","eventId":1,"event":{"type":"text_delta","turn":1,"delta":"Hello"}}
{"type":"stream_end","streamId":"run_123","eventId":42,"status":"completed"}
```

`useChat` unwraps these envelopes before applying events, so UI code still receives normal Anvia
stream events.

## Server Route

Create a resumable stream store outside the request handler. `createMemoryResumableStreamStore()` is
useful for local development and single-process examples. Use a durable store for production.

```ts
import { AgentBuilder, type Message } from "@anvia/core";
import type { UIStreamRequest } from "@anvia/core/ui";
import {
  createEventStream,
  createMemoryResumableStreamStore,
  resumeStreamEvents,
} from "@anvia/server";

const resumableStore = createMemoryResumableStreamStore();

type ChatBody = UIStreamRequest & {
  resume?: {
    streamId: string;
    after: number;
  };
};

function latestUserMessage(messages: Message[]): Message {
  const message = messages.at(-1);
  if (message?.role !== "user") {
    throw new Error("Expected the latest chat message to be from the user.");
  }
  return message;
}

export async function POST(request: Request, params: { threadId: string }) {
  const user = await requireUser(request);
  const body = (await request.json()) as ChatBody;
  const agent = createSupportAgent(user);

  if (body.resume !== undefined) {
    return createEventStream(
      resumeStreamEvents({
        id: body.resume.streamId,
        after: body.resume.after,
        store: resumableStore,
      }),
      { format: "jsonl" },
    );
  }

  const runId = crypto.randomUUID();

  return createEventStream(
    agent
      .session(params.threadId, {
        userId: user.id,
        metadata: { tenantId: user.tenantId },
      })
      .prompt(latestUserMessage(body.messages))
      .stream(),
    {
      format: "jsonl",
      resumable: {
        id: runId,
        store: resumableStore,
      },
    },
  );
}
```

The response reader can disconnect while the run continues. The resumable server wrapper keeps
draining the source stream into the store, so a later request can replay missed events.

## React Client

Enable resume on `useChat` with a stable key for the conversation. The key is local browser state;
the server still uses the `streamId` it generated.

```tsx
import type { Message } from "@anvia/core";
import { initialMessagesFromMemory, useChat } from "@anvia/react";

export function SupportChat({
  threadId,
  messages,
}: {
  threadId: string;
  messages: Message[];
}) {
  const chat = useChat({
    endpoint: `/api/threads/${threadId}/chat`,
    initialMessages: initialMessagesFromMemory(messages),
    resume: {
      key: threadId,
    },
  });

  return <ChatProvider controller={chat}>{/* thread */}</ChatProvider>;
}
```

By default, React stores active resume metadata in `sessionStorage` under an Anvia-prefixed key. The
stored value contains the current `streamId`, last event id, and current UI messages. On mount,
`useChat` automatically sends the same endpoint a POST body with:

```json
{
  "messages": [{ "role": "user", "content": [{ "type": "text", "text": "Hello" }] }],
  "stream": true,
  "resume": {
    "streamId": "run_123",
    "after": 17
  }
}
```

You can use `localStorage` or an explicit `Storage` object when a product needs a different browser
state policy:

```tsx
const chat = useChat({
  endpoint: `/api/threads/${threadId}/chat`,
  resume: {
    key: threadId,
    storage: "localStorage",
  },
});
```

Set `auto: false` when the page should not resume until the user explicitly asks:

```tsx
const chat = useChat({
  endpoint: `/api/threads/${threadId}/chat`,
  resume: {
    key: threadId,
    auto: false,
  },
});

await chat.resume();
```

`stop()`, `reset()`, and starting a new send clear the active resume cursor.

## Production Store

The memory store is not durable and does not work across multiple server processes. Production
deployments should implement `ResumableStreamStore` on top of the system that owns running jobs,
such as Redis, Postgres, or a workflow runtime.

```ts
import type { ResumableStreamStore } from "@anvia/server";

export const resumableStore: ResumableStreamStore = {
  async open(input) {
    return openRunStream(input.streamId);
  },
  async append(input) {
    return appendRunEvent(input.streamId, input.event);
  },
  subscribe(input) {
    return replayThenTailRunEvents({
      streamId: input.streamId,
      after: input.after ?? 0,
    });
  },
  async status(input) {
    return readRunStreamStatus(input.streamId);
  },
  async close(input) {
    return closeRunStream(input.streamId, input.status);
  },
};
```

`subscribe(...)` is the key operation. It must first yield stored records after the requested cursor,
then keep yielding live records while the stream is still running. Once the run closes, the iterable
finishes and `resumeStreamEvents(...)` emits `stream_end`.

## Operational Rules

Treat the resume cursor as a transport recovery mechanism, not as product authorization. The resume
route must still authenticate the user, authorize access to the thread and stream id, and verify that
the stream belongs to the requested tenant or user.

Use memory for future model context and resumable streams for transport replay. They are related but
not interchangeable. A completed conversation should still be persisted through the agent memory
store or your product database.

Choose retention based on your UX. Short retention, such as a few minutes after completion, is often
enough for page reloads and navigation. Longer retention is useful for mobile networks and workflow
surfaces, but the stored events may include prompts, tool arguments, tool results, and errors, so
apply the same redaction and retention rules you use for runtime event logs.
