# Agent Options

```ts
const agent = new Agent({
  id: "agent", // required, stable across restarts
  model, // required CompletionModel from a provider package
  instructions: "...", // system guidance; keep it task-specific
  tools: [...], // AnyTool | ProviderTool | ToolIndex
  mcpServers: [...], // MCP servers (the only path for MCP tools)
  skills: skillSet, // SkillSet from loadSkills() — Agent merges its tools
  context: [...], // static Document or VectorContext entries
  memory: { store }, // MemoryStore for session continuity
  outputSchema: schema, // zod schema for structured final output
  toolChoice, // constrain or force tool use
  maxTurns, // bound runaway loops (e.g. 2-4 for demos)
  middlewares: [...], // AgentMiddleware for cross-cutting tool behavior
  guardrails, // policy input for safety constraints
  temperature, // maxTokens, retries, controls, providerOptions as needed
});
```

## generate vs stream

- `agent.generate({ prompt, session? })` — one shot. Returns `{ type: "response" }`,
  `{ type: "interaction" }` (approval/question), or `{ type: "blocked" }` (guardrail
  stop); never throws for those.
- `agent.stream({ prompt, toolConcurrency? })` — events: `tool_call`,
  `tool_result`, `text_delta`, `response`. Use `toolConcurrency` when parallel
  specialist calls are safe. Requires a streaming-capable model — it throws
  otherwise, so fall back to `generate` for chat-only models.

## Memory

`memory: { store }` with a `MemoryStore` (`load` / `append` / `clear` over
`Message[]`), plus a `session` (`{ sessionId, userId }`) per call:

```ts
const agent = new Agent({ id: "agent", model, instructions: "...", memory: { store } });
await agent.generate({ prompt: "Remember my project is named Anvia.", session });
await agent.generate({ prompt: "What is my project named?", session });
```

Compaction (`afterTokens` / `recentTokens` + token counter + compactor) is opt-in
for long sessions — add it when context growth is the problem, not upfront.
`agent.compactMemory({ session })` forces that compaction on demand.

## Multi-agent

Specialists route by their `name` + `description` text — both optional on
`Agent`, but give them explicitly (`asTool` falls back to a generic description
when omitted). `asTool` itself requires a tool `name` and an explicit
`suspension` policy:

```ts
const coordinator = new Agent({
  id: "coordinator",
  model,
  instructions: "Coordinate specialist agents through tools. ...",
  maxTurns: 4,
  tools: [supportAgent.asTool({ name: "ask_support_agent", suspension: "reject" })],
});
```

Keep the coordinator's instructions to routing + synthesis. Give each specialist
a short task built only from user facts. Prefer `stream` with `toolConcurrency`
for parallel delegation. When members must talk, wait, and spawn each other,
use `AgentTeam` (`references/teams.md`); for static teams/pipelines, check the
cookbook (`07_multi_agent`, `05_pipelines`) before inventing a new pattern.

## Skills wiring

```ts
import { loadSkills, skill } from "@anvia/core/skills";

const skills = await loadSkills(skill.local("./skills"));
const agent = new Agent({ id: "agent", model, instructions: "...", skills });
```

`skill.local(path)` treats the path as one skill when it holds `SKILL.md`,
otherwise as a folder of skills. `loadSkills` builds the system instructions
(name + description + reference/script listing) and the four lazy
`get_skill_*` / `run_skill_script` tools — the Agent only pulls full
instructions, references, or scripts when relevant.
