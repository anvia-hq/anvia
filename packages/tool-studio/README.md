# @anvia/studio

Studio UI and HTTP runtime for Anvia agents, pipelines, graphs, tools, MCPs, memory, status, and
knowledge inspection.

Use this package to serve local agents and pipelines over HTTP, inspect sessions, traces, tools, MCPs, Memory, Status, and Knowledge in the browser UI, and exercise tool approval workflows during development.

## Installation

```sh
pnpm add @anvia/studio @anvia/core
```

In this monorepo, the package is available through the workspace:

```sh
pnpm --filter @anvia/studio build
```

## Usage

```ts
import { Agent } from "@anvia/core";
import { OpenAIClient } from "@anvia/openai";
import { Studio } from "@anvia/studio";

const client = new OpenAIClient({
  apiKey,
});

const agent = new Agent({
  id: "support",
  model: client.completionModel({ modelId: "gpt-5", api: "responses" }),
  name: "Support",
  description: "Answers support questions.",
  instructions: "Answer support questions clearly.",
});

await new Studio([agent]).serve({
  port: 4021,
});
```

Then open:

```txt
http://localhost:4021/ui/playground
```

## Graceful shutdown

`serve()` handles both `SIGINT` and `SIGTERM`. Studio stops accepting work, aborts active Agent and
Pipeline runs, waits for their cancellation observers, and then runs `onShutdown`. Use that callback
to close observability clients or other caller-owned resources:

```ts
await new Studio([agent]).serve({
  port: 4021,
  shutdownTimeoutMs: 30_000,
  onShutdown: async () => {
    await Promise.all([lens.close(), langfuse.close(), otelSdk.shutdown()]);
  },
});
```

`shutdown()` provides the same draining behavior for application-managed lifecycles. `close()`
remains synchronous for compatibility: it aborts active work but does not wait for cleanup.

## Multi-Provider Models

Studio can expose a shared model catalog and let each agent choose from registered providers:

```ts
import { Agent } from "@anvia/core";
import { AnthropicClient } from "@anvia/anthropic";
import { OpenAIClient } from "@anvia/openai";
import { Studio } from "@anvia/studio";

const openai = new OpenAIClient({ apiKey: process.env.OPENAI_API_KEY });
const anthropic = new AnthropicClient({ apiKey: process.env.ANTHROPIC_API_KEY });

const agent = new Agent({
  id: "support",
  model: openai.completionModel({ modelId: "gpt-5", api: "responses" }),
  name: "Support",
  instructions: "Answer support questions clearly.",
});

new Studio([agent], {
  models: {
    providers: [
      {
        id: "openai",
        name: "OpenAI",
        defaultModelId: "gpt-5",
        createCompletionModel: ({ modelId }) =>
          openai.completionModel({ modelId, api: "responses" }),
        listModels: () => openai.listModels(),
        models: [
          {
            id: "gpt-5",
            modalities: { input: ["text", "image", "document"], output: ["text"] },
          },
        ],
      },
      {
        id: "anthropic",
        name: "Anthropic",
        defaultModelId: "claude-sonnet-4-20250514",
        createCompletionModel: ({ modelId }) => anthropic.completionModel({ modelId }),
      },
    ],
    agents: {
      support: {
        defaultModelRef: { providerId: "openai", modelId: "gpt-5" },
        allowed: ["openai:*", { providerId: "anthropic", modelId: "claude-sonnet-4-20250514" }],
      },
    },
  },
}).start();
```

The playground message composer shows the allowed models for the selected agent. API callers can
also select a model per run:

```json
{
  "messages": [{ "role": "user", "content": "Summarize this ticket" }],
  "model": {
    "providerId": "anthropic",
    "modelId": "claude-sonnet-4-20250514"
  },
  "stream": true
}
```

## Browser UI

Studio exposes:

- Chat playground and persisted sessions
- Trace browser and session logs
- Realtime observability stream for session logs, pipeline logs, and completed traces
- Eval suite runner for registered `runEvalSuite` configurations
- Pipeline graph, logs, run history, and replay-from-history controls
- Knowledge-graph explorer with type filters, search, node details, and bounded neighborhood expansion
- Rich agent runtime details, direct tool invocation, static tool, dynamic tool, and MCP inspectors
- Memory explorer for users, conversations, messages, and transcript steps backed by the session store
- Status dashboard for storage adapters, record counts, and enabled capabilities
- Knowledge tabs for static context, dynamic context, dynamic tools, and retrieval log

Studio reads MCP provenance directly from `Agent.mcpServers`. Prefixes configured by an
`McpClient` remain visible in both the MCP inspector and direct tool runner, while the remote tool
name stays available on the typed MCP registration.

### Graph explorer

Register any graph that implements the provider-neutral `GraphExplorer` contract. Both
`@anvia/neo4j` and `@anvia/memgraph` graph registrations can be passed directly:

```ts
const studio = new Studio([agent], {
  graphs: [
    {
      id: "support",
      name: "Support knowledge graph",
      graph,
    },
  ],
});
```

Open `/graphs` and select nodes to inspect their public properties or expand their one-hop
neighborhood. Studio exposes only bounded overview and expansion requests; it does not accept raw
Cypher. Adapter explorer responses also omit stored embeddings and reserved `__anvia_*` properties.

## Session Storage

Studio uses an in-memory store by default. Sessions, traces, and pipeline run history are available while the process is running, but they do not create local files unless you pass an explicit SQLite store. If you omit the port, Studio uses `RUNNER_PORT` and then falls back to `4021`.

Pass `createSqliteSessionStore` to persist Studio data in SQLite:

```ts
import { Studio, createSqliteSessionStore } from "@anvia/studio";

new Studio([agent], {
  stores: {
    sessions: createSqliteSessionStore({ path: ".anvia/studio.sqlite" }),
  },
}).start();
```

SQLite storage uses dedicated `anvia_studio_*` tables so it can share an application database without writing into product tables.

## Exports

- `Studio`
- `createInMemoryStudioStore`
- `createSqliteSessionStore`
- Studio session, trace, approval, pipeline, graph, memory, status, knowledge, tool, MCP, and runtime types

## Development

```sh
pnpm --filter @anvia/studio typecheck
pnpm --filter @anvia/studio test
pnpm --filter @anvia/studio build
```

## Browser sandbox views

Sandbox registrations may include explicit noVNC views. Studio resolves the upstream only through the
inspector's loopback-published port and exposes an authorized, same-origin WebSocket bridge. Studio's
programmatic noVNC client renders the desktop directly, so the stock noVNC splash, toolbar, and password
prompt are not part of the UI.

```ts
const studio = new Studio([agent], {
  sandboxes: [
    {
      inspector: browser.inspector({ files: true, ports: true, processes: true }),
      views: [
        {
          id: "desktop",
          label: "Browser",
          source: browser.desktop,
          access: { mode: "local" },
          authentication: { type: "password", password },
        },
      ],
    },
  ],
});
```

Local mode requires a loopback connection and a same-origin browser request. Remotely reachable Studio
instances must instead provide `{ mode: "authorize", authorize }`; the application callback runs for
the viewer connection, WebSocket upgrade, and every takeover operation. Studio does not provide or infer
an application authentication system. View credentials are omitted from sandbox discovery metadata and
URLs and returned only by the authorized, non-cacheable viewer-connection endpoint.

When a registered agent emits a matching browser tool call, Playground replaces its Sessions sidebar
with a larger resizable desktop panel. The embedded desktop remains view-only until the user explicitly
takes control. That lease blocks Anvia browser tools, is renewed by the UI, and expires when abandoned.
It is a coordination boundary rather than a replacement for application authorization. The Sandboxes
page continues to expose the registered view as inspectable runtime metadata. Closing the Playground
panel restores Sessions without forgetting the current browser; use **Open browser** to show it again.
