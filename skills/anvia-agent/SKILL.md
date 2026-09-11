---
name: anvia-agent
description: Build Anvia agents and tools — Agent options, tool definitions, approvals, memory, streaming, multi-agent teams, and provider wiring.
---

# Anvia Agent Skill

Use this skill when the user wants to build or change an Anvia agent: defining
tools, configuring the `Agent`, handling approvals and streaming, adding memory,
composing specialists, or wiring a provider model.

## Process

1. Define tools first (`references/tools.md`) — zod schemas, approvals.
2. Create the `Agent` (`references/agent-options.md`) — smallest option set that works.
3. Wire the provider model (`references/providers.md`) — keep vendor SDKs in provider packages.
4. Compose specialists when needed (`references/teams.md`) — subagents as tools, or `AgentTeam`.
5. Run `scripts/check-agent.sh` from the app root before claiming done.

## Minimal slice

```ts
import { Agent } from "@anvia/core/agent";
import { createTool } from "@anvia/core/tool";
import { OpenAIClient } from "@anvia/openai";
import { z } from "zod";

const addTool = createTool({
  name: "add",
  description: "Add two numbers together.",
  inputSchema: z.object({
    x: z.number().describe("The first number."),
    y: z.number().describe("The second number."),
  }),
  outputSchema: z.number(),
  execute: (args) => args.x + args.y,
});

const client = new OpenAIClient({
  baseUrl: process.env.OPENAI_BASEURL,
  apiKey: process.env.OPENAI_API_KEY ?? "",
});
const agent = new Agent({
  id: "agent",
  model: client.completionModel({ modelId: "gpt-6-astra", api: "responses" }),
  instructions: "You are a concise assistant. Use tools when useful.",
  maxTurns: 2,
  tools: [addTool],
});

const response = await agent.generate({ prompt: "What is 12 + 30? Use the add tool." });
if (response.type !== "response") throw new Error("Unexpected tool approval request.");
console.log(response.output);
```

## Output

Prefer one agent, few tools, explicit zod schemas. Point to the relevant
reference file instead of pasting its contents into chat.
