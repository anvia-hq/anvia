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
http://localhost:4021/playground
```

## Browser UI

Studio exposes:

- Chat playground and persisted sessions
- Trace browser and session logs
- Pipeline graph, logs, run history, and replay-from-history controls
- Rich agent runtime details, direct tool invocation, static tool, dynamic tool, and MCP inspectors
- Memory explorer for users, conversations, messages, and transcript steps backed by the session store
- Status dashboard for storage adapters, record counts, and enabled capabilities
- Knowledge tabs for static context, dynamic context, dynamic tools, and retrieval log

## Session Storage

Studio uses an in-memory store by default. Sessions, traces, and pipeline run history are available while the process is running, but they do not create local files unless you opt in to SQLite. If you omit the port, Studio uses `RUNNER_PORT` and then falls back to `4021`.

Set `ANVIA_STUDIO_DB` to persist Studio data in SQLite:

```sh
ANVIA_STUDIO_DB=.anvia/studio.sqlite node ./dist/server.js
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
