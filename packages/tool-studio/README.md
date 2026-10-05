# @anvia/studio

A local workspace for building and inspecting Anvia agents. Chat with the agents your application actually runs, follow tool calls and traces, and inspect their memory without creating a separate demo implementation.

## Installation

```sh
pnpm add @anvia/studio @anvia/core @anvia/openai
```

## Quick start

Set `OPENAI_API_KEY`, start the server, then open [localhost:4021/ui/playground](http://localhost:4021/ui/playground).

```ts
import { Agent } from "@anvia/core";
import { OpenAIClient } from "@anvia/openai";
import { Studio } from "@anvia/studio";

const openai = new OpenAIClient({ apiKey: process.env.OPENAI_API_KEY! });
const agent = new Agent({
  id: "support",
  name: "Support",
  model: openai.completionModel({ modelId: "gpt-5", api: "responses" }),
  instructions: "Answer support questions clearly.",
});

await new Studio([agent]).serve({ port: 4021 });
```

## What you get

- Chat playground with model selection, approvals, and saved sessions.
- Agent teams with member activity and human interactions.
- Traces, tool and MCP inspectors, memory, and retrieval views.
- Pipeline execution, history, graphs, and evaluation runs.
- Knowledge-graph exploration and browser sandbox viewing with human takeover.
- Optional SQLite session storage and graceful server shutdown.

Session storage is in memory by default; configure SQLite to persist it across restarts. Studio is intended for local development. Add application authentication and authorization when exposing it remotely.

## Learn more

- [Usage guide](https://github.com/anvia-hq/anvia/blob/main/docs/packages/tool-studio.md)
- [Anvia](https://github.com/anvia-hq/anvia/blob/main/README.md)
- [Contributing](https://github.com/anvia-hq/anvia/blob/main/CONTRIBUTING.md)
