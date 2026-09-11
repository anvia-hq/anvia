# Subagents and Teams

Two composition shapes, chosen by who decides the control flow: when you can
name the delegation graph, wire agents together yourself; when the model must
decide who to call, give it subagent tools; when instances must talk, wait, and
spawn each other, use `AgentTeam`.

## Subagents as tools (you decide)

`agent.asTool({ name, suspension })` wraps an Agent as a callable tool of
another (see `references/agent-options.md` for the coordinator example).
Prefer this when the delegation graph is static and shallow — one coordinator
calling named specialists, optionally fanned out in parallel via
`toolConcurrency`. Each call is independent; subagents share nothing but the
model.

## AgentTeam (the model decides)

`AgentTeam` from `@anvia/core/agent` runs a coordinator plus member agents as
one supervised runtime:

```ts
import { Agent, AgentTeam } from "@anvia/core/agent";

const researcher = new Agent({ id: "researcher", model, instructions: "Find facts only." });
const writer = new Agent({ id: "writer", model, instructions: "Draft from findings only." });

const team = new AgentTeam({
  id: "research-team", // coordinator options (id, model, instructions, tools, memory...)
  model,
  instructions: "Coordinate research and drafting through your member tools.",
  members: [researcher, writer], // required; Agent instances, unique ids
  communication: { siblings: true }, // default false
  limits: { maxConcurrentAgents: 4 },
});

const outcome = await team.generate({ prompt: "Brief the team and produce a memo." });
console.log(
  outcome.output,
  outcome.usage,
  outcome.members.map((m) => `${m.name}:${m.status}`),
);
```

Constructor options are coordinator `AgentOptions` plus:

- `members` — required array of `Agent` instances. Member ids must be unique
  and match `^[a-zA-Z0-9_-]{1,58}$` because they become spawn tool names.
- `spawning: [{ from, to }]` — additional spawn permissions between members;
  the coordinator can always spawn every member.
- `communication: { siblings: true }` — allow messaging and waiting between
  instances with the same parent (default false).
- `limits` — `maxDepth` (3), `maxConcurrentAgents` (4), `maxAgentInstances`
  (12), `maxTotalTurns` (100), `maxBufferedEvents` (1024). Breaching a limit
  raises `AgentTeamLimitError`; unread stream-event overflow cancels the run.

The runtime injects reserved tools — `spawn_<memberId>`, `send_message`,
`wait_for_agent`, `list_agents`, `cancel_agent`. A member tool with one of
those names throws at construction.

## Running teams

- `generate({ prompt })` or `{ messages }` — exactly one. Returns the
  coordinator outcome (`response` or `blocked`) plus `teamRunId`, aggregate
  `usage`, and per-instance `members` summaries (status, usage, outcome).
- `stream()` — async events: `agent_queued` / `agent_started` /
  `agent_waiting` / `agent_idle` / `agent_failed` / `agent_cancelled`,
  `message_queued` / `message_delivered`, `interaction`, and nested
  `agent_event`s (each tagged with the emitting instance). Also exposes
  `textStream`, `text`, `result`, `steer(input)`, and `cancel(reason?)`.
- Interactions from any member (tool approvals, questions) must be resolved at
  the team level: pass `resolveInteraction(request) => response` on the run.
  Without it, an interaction fails the run with `AgentTeamInteractionError`.

## Rules

- Keep members narrow: one task each, explicit `name` + `description`, facts
  in, facts out — the coordinator routes by that text.
- One coordinator; do not nest teams inside teams. Escalating depth is what
  `limits.maxDepth` is there to stop.
- A fixed sequence of agent steps is a pipeline (`.agent()` stage — see the
  `anvia-pipeline` skill), not a team.
- Studio renders team runs with steer, cancel, and interaction cards — see the
  `anvia-studio` skill.
