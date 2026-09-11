---
name: anvia-studio
description: Run and inspect Anvia agents in Studio — local serving, playground, traces, approvals, sessions, evals, and observability.
---

# Anvia Studio Skill

Use this skill when the user wants to run agents locally and see what happens:
serving agents/pipelines over HTTP, using the playground, inspecting traces and
sessions, exercising tool approvals, running eval suites, or wiring
observability.

## Process

1. Serve the agents (`references/serve.md`) — smallest `Studio` that runs.
2. Debug through the inspectors (`references/inspect.md`) — playground first,
   then traces, approvals, sessions.
3. Wire observability (`references/observe.md`) — only when runs must be
   auditable or production-like.
4. Run `scripts/check-studio.sh` from the app root before claiming done.

## Minimal slice

```ts
import { Agent } from "@anvia/core";
import { OpenAIClient } from "@anvia/openai";
import { Studio } from "@anvia/studio";

const client = new OpenAIClient({ apiKey: process.env.OPENAI_API_KEY });
const agent = new Agent({
  id: "support",
  model: client.completionModel({ modelId: "gpt-6-astra", api: "responses" }),
  name: "Support",
  description: "Answers support questions.",
  instructions: "Answer support questions clearly.",
});

await new Studio([agent]).serve({ port: 4021 });
// Open http://localhost:4021/ui/playground
```

## Output

Studio is a development surface, not production hosting. Point to the relevant
reference file instead of pasting its contents into chat.
