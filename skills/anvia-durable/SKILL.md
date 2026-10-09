---
name: anvia-durable
description: Build recoverable Anvia workflows with @anvia/durable — durable main agents, owned subagents, task graphs, tool/effect recovery, persisted waits, and remote controls. Use when execution must survive restarts; ordinary agent streaming, AgentTeam, and session memory alone are not durable execution.
---

# Anvia Durable Skill

Use this skill to implement or review execution that must survive process restarts.
The package is experimental: target one supervised Node.js process and one local SQLite
owner. Do not present it as a distributed worker service or automatically production-ready.
The durable cookbook remains withheld.

## Choose the execution boundary

| Need                                                          | API and boundary                                                                                                    |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| One main agent with conversation history                      | Register an `Agent`, then `runtime.submit()` → `DurableRun`                                                         |
| A fixed graph of agent dependencies                           | `runtime.submitGraph()` → static agent DAG                                                                          |
| A main workflow coordinating dynamic subagents or custom work | `defineTask()` → `runtime.submitTask()`; spawn children through its `TaskContext`                                   |
| A model decides the plan                                      | Run the planner as an owned agent; validate its saved JSON output in the orchestration task before spawning workers |
| Model-selected local tools                                    | Static `createTool()` tools on each registered agent; classify `toolRecovery`                                       |
| External work performed by task code                          | `await ctx.effect(stableKey, jsonInput, callback, recovery)`                                                        |
| A human decision or external callback                         | Agent `run.respond()` or custom-task `signal()`; they are different protocols                                       |

A **task handler** has `ctx.spawnAgent`, `ctx.spawn`, and `ctx.effect`. A normal agent tool
has `ToolCallContext`, including `operationId` and `abortSignal`; it does not have task spawn
methods. A main agent's `agent.asTool()` delegates an ordinary inner execution, not a separately
checkpointed owned child. Do not claim that `AgentTeam`, `Pipeline`, direct `generate/stream`,
or a memory adapter becomes durable by being called inside another function.

## Workflow and references

1. Choose the smallest boundary above. For registration, supported agent options, root IDs,
   history, and the `agent.stream()` distinction, read [agents-and-runtime.md](references/agents-and-runtime.md).
2. For a main workflow with specialists, dynamic planning, dependencies, joins, timers,
   signals, and the exposed tree, read [tasks-and-subagents.md](references/tasks-and-subagents.md).
3. Before adding side effects, classify interruption behavior and wire idempotency or
   reconciliation using [tools-and-recovery.md](references/tools-and-recovery.md).
4. For HTTP/browser access, authorization, deployment, quotas, backup, or version changes,
   read [operations-and-http.md](references/operations-and-http.md).

Use the installed package's public types to verify the examples against its version.
These references describe the current schema-7 package, including operational controls and
custom-task HTTP APIs. An older npm release may not contain them; do not invent compatibility
wrappers or silently remove guarantees. Use the matching workspace build or package release.

For an objective spanning bounded agent sessions, read [goals.md](references/goals.md).
Use `defineGoal()` registered in `tasks` and `runtime.submitGoal()`; require application-owned
completion verification and respect the distinction between hard model-turn budgets and
between-session token/deadline admission limits.

## Invariants that affect implementation

- Keep one application-scoped runtime per database. Supply custom task definitions at open.
  Agents can be supplied at open or added with `registerAgents()` without restarting work.
  Restore unfinished registrations before `resume()`; `unregisterAgent()` only releases idle
  registrations. Call `close()` during shutdown.
- The engine replays committed model/tool/effect results and re-enters task phases from
  checkpoints. It does not restore JavaScript stacks, local variables, or arbitrary promises.
- Persist identifiers and phase state. Keep child/effect keys stable across replay; a key is
  scoped to its parent's or task's entire lifetime. Root request IDs come from a stable job ID.
- Keep initializers, migrations, schemas, tool definitions, and approval predicates pure.
  Checkpoints/results must round-trip as JSON. Await every started effect before returning.
- Return a `waiting` transition to release task capacity. Do not poll or await another durable
  handle's `result()` inside a parent phase. A successful parent waits for all owned work to settle.
- Completed results are reused. An external operation that succeeded before its result committed
  is uncertain; the external service must deduplicate it or an operator must reconcile it.
  Merely choosing `idempotent` does not create exactly-once behavior.
- The currently unsupported agent options are memory, lifecycle callbacks, middleware,
  guardrails, context sources, MCP servers, provider tools, and dynamic tool indexes. Do not
  bypass registration checks by hiding those integrations inside unchecked callbacks.
- Streams expose committed progress and, with registration `stream: true`, persisted generation
  deltas grouped by unique attempt IDs. Partial output is provisional; replace it on a new attempt.
  Aborting a subscription does not cancel execution. Approvals and recovery blocks require explicit authorized decisions.

## Verify and deliver

Run the app's relevant typecheck/tests. For a local no-network compatibility smoke check:

```sh
sh skills/anvia-durable/scripts/check-durable.sh --dir /path/to/app
```

The script uses the app's installed packages, a temporary SQLite file, and a fake model/tool.
It verifies owned-agent completion, a persisted signal wait, reopening, stable identities,
and reuse of committed tool/effect results. It never opens the app's live database and does
not certify the app's own workflow, provider, authorization, or production readiness.

For the implemented workflow, also verify its actual replay boundaries: kill/reopen at the
chosen effect boundary, preserve pending approvals, deliver duplicate signals, cancel a tree,
and inspect children after restart. Do not exercise real external mutations without the
user's authorization. Report the chosen topology, recovery policies, validation run, and
remaining operational limits; never mark blocked work completed merely to make a demo pass.
