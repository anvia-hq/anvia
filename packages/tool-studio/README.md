# @anvia/studio

Studio UI and HTTP runtime for Anvia agents, pipelines, tools, MCPs, memory, status, and knowledge inspection.

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
import { AgentBuilder } from "@anvia/core";
import { OpenAIClient } from "@anvia/openai";
import { Studio } from "@anvia/studio";

const client = new OpenAIClient({
  apiKey,
});

const agent = new AgentBuilder("support", client.completionModel())
  .name("Support")
  .description("Answers support questions.")
  .instructions("Answer support questions clearly.")
  .build();

new Studio([agent]).start({
  port: 4021,
});
```

Then open:

```txt
http://localhost:4021/ui/playground
```

## Multi-Provider Models

Studio can expose a shared model catalog and let each agent choose from registered providers:

```ts
import { AgentBuilder } from "@anvia/core";
import { AnthropicClient } from "@anvia/anthropic";
import { OpenAIClient } from "@anvia/openai";
import { Studio } from "@anvia/studio";

const openai = new OpenAIClient({ apiKey: process.env.OPENAI_API_KEY });
const anthropic = new AnthropicClient({ apiKey: process.env.ANTHROPIC_API_KEY });

const agent = new AgentBuilder("support", openai.completionModel("gpt-5"))
  .name("Support")
  .instructions("Answer support questions clearly.")
  .build();

new Studio([agent], {
  models: {
    providers: [
      {
        id: "openai",
        name: "OpenAI",
        defaultModel: "gpt-5",
        createCompletionModel: (model) => openai.completionModel(model),
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
        defaultModel: "claude-sonnet-4-20250514",
        createCompletionModel: (model) => anthropic.completionModel(model),
      },
    ],
    agents: {
      support: {
        default: "openai:gpt-5",
        allowed: ["openai:*", "anthropic:claude-sonnet-4-20250514"],
      },
    },
  },
}).start();
```

The playground message composer shows the allowed models for the selected agent. API callers can
also select a model per run:

```json
{
  "message": "Summarize this ticket",
  "model": "anthropic:claude-sonnet-4-20250514",
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
- Rich agent runtime details, direct tool invocation, static tool, dynamic tool, and MCP inspectors
- Memory explorer for users, conversations, messages, and transcript steps backed by the session store
- Status dashboard for storage adapters, record counts, and enabled capabilities
- Knowledge tabs for static context, dynamic context, dynamic tools, and retrieval log

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
- Studio session, trace, approval, pipeline, memory, status, knowledge, tool, MCP, and runtime types

## Development

```sh
pnpm --filter @anvia/studio typecheck
pnpm --filter @anvia/studio test
pnpm --filter @anvia/studio build
```
