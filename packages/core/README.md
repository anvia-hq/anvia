# @anvia/core

Small, explicit, embeddable runtime contracts for Anvia agents, tools, structured extraction, pipelines, streaming, RAG, MCP, skills, and observability.

This package is provider-neutral. Pair it with a provider adapter such as `@anvia/openai`, `@anvia/anthropic`, or `@anvia/gemini` to create runnable model objects, then pass those objects into agents, extractors, pipelines, or direct completion helpers.

## Design Philosophy

`@anvia/core` owns the model/tool loop and the runtime contracts around it. Your application owns provider client construction, credentials, product data access, permissions, storage, deployment, observability backends, and response shape.

The package is dependency-injection oriented: create provider models, typed tools, memory stores, vector indexes, observers, and services in application code, then pass the relevant objects into agents, prompt requests, runners, or adapters. Core receives those objects and coordinates the run without taking over product architecture.

## Installation

```sh
pnpm add @anvia/core
```

In this monorepo, the package is available through the workspace:

```sh
pnpm --filter @anvia/core build
```

## Usage

```ts
import { z } from "zod";
import { Agent, createTool } from "@anvia/core";
import { OpenAIClient } from "@anvia/openai";

const client = new OpenAIClient({
  apiKey,
});

const model = client.completionModel({ modelId: "gpt-5", api: "responses" });

const lookupOrder = createTool({
  name: "lookup_order",
  description: "Look up an order by id.",
  inputSchema: z.object({ orderId: z.string() }),
  execute: async ({ orderId }) => ({ orderId, status: "processing" }),
});

const agent = new Agent({
  id: "support",
  model,
  instructions: "Help customers with order questions.",
  maxTurns: 4,
  tools: [lookupOrder],
});

const result = await agent.generate({ prompt: "What is happening with order A123?" });
if (result.status === "completed") console.log(result.output);
```

## Direct Completions

Use `generateCompletion` for one provider call without Agent turns, memory, or local tool
execution. The model and input are part of one options object:

```ts
import { generateCompletion } from "@anvia/core";
import { OpenAIClient } from "@anvia/openai";

const model = new OpenAIClient({ apiKey }).completionModel({ modelId: "gpt-5", api: "responses" });

const result = await generateCompletion({
  model,
  prompt: "Summarize Anvia in one sentence.",
  instructions: "Answer clearly and concisely.",
});

console.log(result.output); // string
```

Use `messages` when the application already owns the transcript. Exactly one of `prompt` or
`messages` is required:

```ts
import { generateCompletion, type Message } from "@anvia/core";

const result = await generateCompletion({
  model,
  messages: [
    { role: "system", content: "You are concise." },
    { role: "user", content: "Explain Anvia." },
  ] satisfies readonly Message[],
  maxTokens: 300,
  providerOptions: {
    reasoning: { effort: "low" },
  },
});
```

Messages are plain, readonly `{ role, content }` objects. Use structural literals with
`satisfies Message` or `satisfies readonly Message[]`; there is no message factory namespace.
Multimodal user content uses `text`, `image`, and `file` parts, while assistant tool calls use
`{ type: "tool-call", toolCallId, toolName, input }`. At external boundaries, validate with
`parseMessage`, `parseMessages`, `messageSchema`, or an application-specific
`createMessageSchema({ metadataSchema })`.

Add `outputSchema` to the same function for typed, schema-validated output:

```ts
import { generateCompletion } from "@anvia/core";
import { z } from "zod";

const result = await generateCompletion({
  model,
  prompt: "Extract: Acme reports a high-priority checkout failure.",
  outputSchema: z.object({
    customer: z.string(),
    priority: z.enum(["low", "medium", "high"]),
  }),
});

console.log(result.output.priority); // fully typed
```

`CompletionResult` consistently contains `output`, the original `text`, normalized `content`,
`usage`, and `rawResponse`, plus optional message, context, source, and provider-tool metadata.

Use `streamCompletion` for the streaming form:

```ts
import { streamCompletion } from "@anvia/core";

for await (const event of streamCompletion({
  model,
  prompt: "Write a short launch note.",
})) {
  if (event.type === "text_delta") process.stdout.write(event.delta);
  if (event.type === "final") console.log(event.result.usage);
  if (event.type === "error") console.error(event.error);
}
```

Tool-call deltas are always emitted when a provider supplies them; there is no opt-in flag. A
high-level stream emits at most one terminal `error` event and then closes. Provider model adapters
use the lower-level `CompletionModelStreamEvent`, whose terminal event is `{ type: "final",
response }`; `streamCompletion` normalizes it to `{ type: "final", result }`.

Client requests carry core `Message[]`, so an endpoint can validate and pass them directly:

```ts
import { completionToClientStream, parseClientStreamRequest } from "@anvia/client";
import { streamCompletion } from "@anvia/core";
import { createClientStreamResponse } from "@anvia/server";

const body = parseClientStreamRequest(await request.json());
const events = completionToClientStream({
  events: streamCompletion({ model, messages: body.messages }),
});
return createClientStreamResponse({ events });
```

Core does not own UI messages, HTTP transports, or the public wire protocol. Those boundaries live
in `@anvia/client`, `@anvia/server`, and framework packages such as `@anvia/react`.

## Retries, Provider Options, and Cancellation

Direct completion and media calls accept `retries?: RetryOptions | false`. An omitted or `false`
value makes one provider attempt; `{}` enables the default retry policy. Only retry-safe provider
calls are repeated.

```ts
const controller = new AbortController();

const result = await generateCompletion({
  model,
  prompt: "Summarize this incident.",
  retries: { maxAttempts: 3, initialDelayMs: 100, maxDelayMs: 1_000 },
  abortSignal: controller.signal,
  providerOptions: { reasoning: { effort: "medium" } },
});
```

`providerOptions` contains strict JSON passed to an adapter. Canonical Anvia fields such as model,
input, temperature, tools, dimensions, text, and voice take precedence over conflicting provider
keys. Cancellation is forwarded to provider SDK calls and is never retried.

## Agents

Agents own their default retry policy. A run with no `retries` value inherits the Agent setting;
`false` disables it for that run; an object replaces it for that run. Retries apply to the current
provider call only, so completed tools and earlier turns are never replayed.

```ts
const agent = new Agent({
  id: "support",
  model,
  retries: { maxAttempts: 3 },
});

await agent.generate({ prompt: "Try normally." });
await agent.generate({ prompt: "Do not retry this run.", retries: false });
await agent.generate({
  prompt: "Use one custom policy.",
  retries: { maxAttempts: 2, initialDelayMs: 0, maxDelayMs: 0 },
});
```

Agent results are discriminated by `status`. Completed results include typed `output` and `text`;
guardrail blocks return `status: "blocked"`, `stage`, and `text`; tool approvals and first-class
questions return a JSON-safe `status: "suspended"` result.

```ts
const result = await agent.generate({ prompt: "Help with this request." });

if (result.status === "completed") console.log(result.output);
if (result.status === "blocked") console.log(result.stage, result.text);
if (result.status === "suspended") {
  const resumed = await agent.generate({
    continuation: result.continuation,
    response:
      result.interaction.type === "tool-approval"
        ? { type: "tool-approval", approved: true }
        : {
            type: "tool-question",
            answers: result.interaction.questions.map((question) => ({
              questionId: question.id,
              value: "application-provided answer",
            })),
          },
  });
  console.log(resumed.status, resumed.resumedFrom);
}
```

Keep continuations server-side. A resumed phase receives a new `runId`; Core validates the
continuation and current Agent/tool registration but does not provide a durable continuation store
or exactly-once execution. Use `createQuestionTool({ name, description })` when a model must ask for
structured free-text or choice answers.

An Agent with `outputSchema` carries that output type through `generate`, `stream`, `asTool`, and
Pipeline Agent stages. Agent stream finals use the same result shape:

```ts
for await (const event of agent.stream({ prompt: "Help with this request." })) {
  if (event.type === "final") {
    if (event.result.status === "completed") console.log(event.result.output);
    else console.log(event.result.stage, event.result.text);
  }
}
```

Pass `abortSignal` on a run to cancel the active provider call, tools, and nested Agent tools.

## Memory

Configure durable conversation memory on the Agent, then run through a session:

```ts
import { Agent, type MemoryStore, type Message } from "@anvia/core";
import type { MemoryAppendOptions, MemoryScope } from "@anvia/core/memory";

class AppMemoryStore implements MemoryStore {
  private readonly sessions = new Map<string, Message[]>();

  async load({ scope }: { scope: MemoryScope }): Promise<Message[]> {
    return [...(this.sessions.get(scope.sessionId) ?? [])];
  }

  async append(input: MemoryAppendOptions): Promise<void> {
    const current = this.sessions.get(input.scope.sessionId) ?? [];
    this.sessions.set(input.scope.sessionId, [...current, ...input.messages]);
  }

  async clear({ scope }: { scope: MemoryScope }): Promise<void> {
    this.sessions.delete(scope.sessionId);
  }
}

const memory = new AppMemoryStore();
const agent = new Agent({
  id: "support",
  model: model,
  memory: { store: memory },
});

const session = { sessionId: "thread_123", userId: "user_456" };
await agent.generate({ prompt: "Remember my plan.", session });
await agent.generate({ prompt: "What is my plan?", session });
```

Memory defaults to `savePolicy: "message"`, which saves the user prompt, each completed assistant message, and each completed tool result as soon as they are ready. You can choose `"turn"` or `"run"` at configuration time:

```ts
new Agent({
  id: "support",
  model,
  memory: { store: memory, savePolicy: "turn" },
});
```

Without `session`, the same Agent is stateless. Pass `{ messages }` when the caller already owns a
complete transcript; transcripts cannot be combined with persisted sessions.

Compaction is an explicit Agent policy over a store capability. The adapter persists the summary as
an ordinary system message with `metadata.anvia.memoryCompaction`, so `load()` and inspectors expose
exactly what future runs receive:

```ts
import { createSummaryMemoryCompactor } from "@anvia/core/memory";

const compactor = createSummaryMemoryCompactor({
  model: summaryModel,
  maxTokens: 1024,
  retries: { maxAttempts: 2 },
});

const agent = new Agent({
  id: "support",
  model,
  memory: {
    store: memory,
    savePolicy: "message",
    compaction: {
      trigger: { afterMessages: 50 },
      retention: { recentUserTurns: 4 },
      compactor,
      conflictRetries: false,
    },
  },
});

for await (const event of agent.stream({ prompt: "What did we decide?", session })) {
  if (event.type === "memory_compaction") {
    console.log(event.compactedMessageCount, event.usage);
  }
}
```

The trigger is a threshold, not a hard storage limit. Summary-provider retries belong to the
compactor; full snapshot-to-replacement conflict retries are separately opt-in.

## Structured Extraction

```ts
import { extract } from "@anvia/core/extractor";
import { z } from "zod";

const ticketSchema = z.object({
  customer: z.string(),
  priority: z.enum(["low", "medium", "high"]),
  summary: z.string(),
});

const { output: ticket } = await extract({
  model,
  text: "Acme Co. reports checkout failures. Priority is high.",
  outputSchema: ticketSchema,
  retries: { maxAttempts: 2 },
});
```

## Pipelines

```ts
import { Pipeline } from "@anvia/core/pipeline";
import { z } from "zod";

const pipeline = new Pipeline({ id: "support-flow", inputSchema: z.string() })
  .agent({
    id: "draft",
    agent,
    suspension: "reject",
    request: ({ input }) => ({ prompt: `Draft a reply for this ticket:\n\n${input}` }),
  })
  .extract({
    id: "parse",
    model,
    outputSchema: ticketSchema,
    text: ({ input }) => input,
  });

const { runId, output } = await pipeline.run({
  input: "Customer cannot complete checkout.",
});
```

## Documents

Applications own file discovery, file reads, source metadata, and per-file error policy. Core only
provides deterministic in-memory chunking and scoped PDF text extraction:

```ts
import { readFile } from "node:fs/promises";
import { chunkText, extractPdfText } from "@anvia/core/documents";

const text = await readFile("guide.txt", "utf8");
const chunks = chunkText({
  text,
  strategy: "recursive",
  maxSize: 1_000,
  overlap: 100,
  separators: ["\n\n", "\n", " "],
});

const { pages } = await extractPdfText({
  data: new Uint8Array(await readFile("guide.pdf")),
  abortSignal,
});
```

Use `strategy: "fixed"` for deterministic sliding windows. Recursive chunking requires an explicit
separator order and falls back to fixed-size splitting when none of those separators can divide an
oversized section. Chunk offsets use JavaScript string indices and always identify the exact source
slice. PDF pages are one-based, and the parser task is disposed before extraction settles.
If parsing or abort handling fails together with parser cleanup, extraction rejects with an
`AggregateError` containing the operation failure first and the cleanup failure second.

## Media

Media helpers follow the same one-object API and share `providerOptions`, `retries`, and
`abortSignal`:

```ts
import { generateImage, generateSpeech, transcribe } from "@anvia/core";

const image = await generateImage({
  model: client.imageGenerationModel({ modelId: "gpt-image-1" }),
  prompt: "A compact robot drawing an architecture diagram.",
  width: 1024,
  height: 1024,
});
console.log(image.images[0].data);

const speech = await generateSpeech({
  model: client.speechGenerationModel({ modelId: "gpt-4o-mini-tts" }),
  text: "Hello from Anvia.",
  voice: "alloy",
});

const transcript = await transcribe({
  model: client.transcriptionModel({ modelId: "gpt-4o-mini-transcribe" }),
  audio: {
    data: speech.audio.data,
    filename: "speech.mp3",
    mediaType: speech.audio.mediaType,
  },
});
console.log(transcript.text);
```

## MCP

MCP clients own connections. Agents receive immutable server registrations and never own or close
the underlying transport:

```ts
import { Agent } from "@anvia/core/agent";
import { McpClient, McpClientGroup } from "@anvia/core/mcp";

const filesystem = new McpClient({
  name: "filesystem",
  transport: {
    type: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "./workspace"],
  },
});
const github = new McpClient({
  name: "github",
  transport: {
    type: "streamableHttp",
    url: "https://mcp.example.com/mcp",
    headers: { authorization: `Bearer ${process.env.MCP_TOKEN}` },
  },
  tools: { prefix: "github_" },
});

const mcp = await McpClientGroup.connect({ clients: [filesystem, github] });
const agent = new Agent({ id: "assistant", model, mcpServers: mcp.servers });

try {
  await agent.generate({ prompt: "Find the issue and update it." });
} finally {
  await mcp.close();
}
```

Construction performs no I/O. `connect()` discovers every tool page once and returns a frozen
registration snapshot. Reconnect and rebuild the Agent to adopt changed remote tools. Built-in
Streamable HTTP connections enforce Anvia URL safety by default and do not accept a custom `fetch`.
Static request headers are explicit transport configuration; arbitrary Fetch `RequestInit` fields
are not exposed because the MCP transport owns its HTTP method, body, abort signal, session, and
protocol headers. Configured headers are sent only to the exact MCP endpoint, are not attached to
OAuth requests, and cause endpoint redirects to fail instead of forwarding credentials. A static
`authorization` header cannot be combined with `authProvider`.
For an intentionally local or private-network server, set `ssrfProtection: "disabled"` on that
transport. This disables hostname and DNS restrictions for the complete transport, including
redirects and OAuth discovery, while still requiring HTTP(S). Use it only when the application owns
and trusts that network boundary. MCP server instructions remain inspectable metadata and are not
added to Agent instructions.

## Public Areas

- `agent`: typed Agent runtime, continuations, interactions, retries, and stream events
- `tool`: typed tool creation and tool sets
- `completion`: direct completion helpers and provider-neutral model contracts
- `memory`: durable session memory interfaces and in-memory store
- `extractor`: schema-first structured extraction
- `pipeline`: typed sequential and parallel workflows
- `embeddings`: embedding helpers and document embedding utilities
- `vector-store`: in-memory vector search and vector search tools
- `streaming`: normalized stream helpers
- `mcp`: lifecycle-owning MCP clients, groups, and immutable Agent registrations
- `skills`: local skill loading
- `observability`: observer interfaces for runs, generations, and tool calls
- `evals`: evaluation helpers and reporters
- `documents`: in-memory text chunking and PDF text extraction
- `speech-generation`, `image-generation`, `transcription`: provider-neutral media interfaces

## Development

```sh
pnpm --filter @anvia/core typecheck
pnpm --filter @anvia/core test
pnpm --filter @anvia/core build
```
