# @anvia/studio

Studio UI and HTTP runtime for Anvia agents, pipelines, tools, MCPs, and knowledge inspection.

Use this package to serve local agents and pipelines over HTTP, inspect sessions, traces, tools, MCPs, and Knowledge in the browser UI, and exercise tool approval workflows during development.

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
- Pipeline graph, logs, and run history
- Agent, static tool, dynamic tool, and MCP inspectors
- Knowledge tabs for static context, dynamic context, dynamic tools, and retrieval log

## Session Storage

Studio uses a local SQLite store by default so sessions, traces, and pipeline run history can persist across process restarts. If you omit the port, Studio uses `RUNNER_PORT` and then falls back to `4021`.

Set `ANVIA_STUDIO_DB` to control the database path:

```sh
ANVIA_STUDIO_DB=.anvia/studio.sqlite node ./dist/server.js
```

## Exports

- `Studio`
- `createSqliteSessionStore`
- Studio session, trace, approval, pipeline, knowledge, tool, MCP, and runtime types

## Development

```sh
pnpm --filter @anvia/studio typecheck
pnpm --filter @anvia/studio test
pnpm --filter @anvia/studio build
```
