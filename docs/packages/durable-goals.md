# Durable goals

`defineGoal()` builds a persistent controller around sequential, bounded agent sessions.
Register it in `DurableRuntime.open({ tasks })` and call `runtime.submitGoal()`.
The returned task handle exposes the whole ownership tree, progress, cancellation, and signals.
Reacquire it after restart with `runtime.getTask(id)`, restore the same definitions and agent
registrations, and call `runtime.resume()`.

```ts
import { defineGoal, DurableRuntime } from "@anvia/durable";
import { SqliteDurableStore } from "@anvia/durable/sqlite";

// builder is an Agent with maxTurns, local tools, and an optional outputSchema.
// verifyProject is an application-owned, read-only acceptance check. Its result
// must describe observed progress, rather than trusting the agent's completion claim.
const build = defineGoal({
  name: "verified-build",
  version: 1,
  agentId: builder.id,
  assess: async ({ acceptanceCriteria }, signal) => {
    const check = await verifyProject(acceptanceCriteria, { signal });
    return {
      status: check.passed ? "complete" : check.blocked ? "blocked" : "continue",
      progressKey: check.artifactHash,
      summary: check.summary,
      next: check.nextAction,
      evidence: check.evidence,
    };
  },
});

const runtime = await DurableRuntime.open({
  store: new SqliteDurableStore("./goals.sqlite"),
  agents: [{ agent: builder, version: "builder-v1" }],
  tasks: [build],
});
await runtime.resume();
const goal = await runtime.submitGoal(build, {
  sessionId: "project-42",
  requestId: "implement-search",
  objective: "Implement search",
  acceptanceCriteria: ["Search acceptance tests pass", "Existing tests pass"],
  limits: {
    maxSessions: 100,
    maxTotalModelTurns: 10_000,
    maxConsecutiveNoProgressSessions: 3,
    maxTotalTokens: 2_000_000,
  },
});
const result = await goal.result(); // waits through pauses; aborting this wait does not cancel work
console.log(result.handoff.evidence);
```

`assess` is required and returns a `GoalDecision`, validated with `goalDecisionSchema`.
It receives the effective `agentId`, original objective and criteria, previous verified handoff, and a session
record containing output, messages, usage, model-turn count, and `response` or `exhausted` status.
Use these as evidence for your application's checks. Returning `complete` is the trusted
completion decision; merely returning a final model answer does not complete the goal.

The assessor must be read-only and safe to repeat. Its decision is journaled as a safe task
effect and reused after commit. A crash before that commit can repeat assessment. It must
honor its abort signal. It is not a separately owned agent: model calls or external work hidden
inside it are not covered by the goal's session budget, agent recovery, or tool policies.
Use deterministic acceptance checks for this initial API. Failed assessment or invalid decisions require attention;
fix the assessor or restore its dependencies before explicitly retrying the task.

Each new child receives the original objective, acceptance criteria, last verified handoff,
and operator feedback. Raw transcripts are retained on child runs, not automatically appended
to the next prompt. Put necessary artifact references and remaining work in `summary`, `next`,
and `evidence`; use agent tools to load large artifacts. Existing registration compaction still
applies inside each session. Compaction does not reset any turn budget.

## Per-submission agents

`agentId` is optional in both `defineGoal()` and the submission. The submission overrides the
definition's default: `input.agentId ?? policy.agentId`. Register one goal definition at startup,
then register a captured agent for each user or request before submitting its goal:

```ts
const buildForUser = defineGoal({
  name: "user-build",
  version: 1,
  assess: async ({ agentId, acceptanceCriteria }, signal) => {
    // Application-owned verification scoped to the captured agent's work.
    const check = await verifyUserProject(agentId, acceptanceCriteria, { signal });
    return {
      status: check.passed ? "complete" : "continue",
      progressKey: check.artifactHash,
      summary: check.summary,
      next: check.nextAction,
      evidence: check.evidence,
    };
  },
});
const runtime = await DurableRuntime.open({
  store: new SqliteDurableStore("./user-goals.sqlite"),
  tasks: [buildForUser],
});

// userAgent is an application-created Agent with a unique ID and captured user/request tools.
runtime.registerAgents([{ agent: userAgent, version: "user-builder-v1" }]);
const goal = await runtime.submitGoal(buildForUser, {
  agentId: userAgent.id,
  sessionId: "user-42/project-7",
  requestId: "build-search",
  objective: "Implement search",
  acceptanceCriteria: ["Search acceptance tests pass"],
  limits: {
    maxSessions: 100,
    maxTotalModelTurns: 10_000,
    maxConsecutiveNoProgressSessions: 3,
  },
});
```

Submission rejects a missing effective ID or an agent that is not currently registered, without
persisting a new goal. This also applies to `submitTask()` and `submitRegisteredTask()`; for the
task HTTP/client API put `agentId` inside the submission's `input` object alongside `objective`,
`acceptanceCriteria`, and `limits`. An agent ID selects a registration; the application remains
responsible for authorizing that choice for the submitting user.

Each new goal captures its effective agent ID in its initial checkpoint, including when it uses
the definition's default. All later sessions and assessments use that saved ID. Changing a
definition's default does not redirect an existing goal, and two goals using one definition can
run different agents. Original submission inputs remain unchanged for request deduplication.

Restore the captured registration with the same ID and compatible version/tools after a restart.
If it is missing when a new session is spawned, the goal enters `needs_attention`; re-register it
and call the goal task handle's `retry()`. If an already-created child run needs attention, restore
its registration and retry that run with `run.retry()`. Registration alone does not retry work.
The runtime does not fall back to another agent.

### Existing goals and versions

The strict input and checkpoint schemas accept an optional `agentId`; unknown fields are still
rejected. Goals persisted before this feature have neither field and retain their definition's
`policy.agentId`. On their first recovered phase, that ID is pinned in the checkpoint before any
new work. Keep the original default when restoring those legacy goals.

No SQLite schema or goal definition version bump is required for this additive change. Existing
assessment journal inputs retain their shape so committed decisions can still replay; the
assessor receives `agentId` alongside that context when it executes. Task version fencing is
unchanged: a different version still requires a migration, and `defineGoal()` does not provide
one. Restore the original definition version; use a new name/version for incompatible policies.
Older package versions cannot parse the new binding fields, so do not downgrade a database once
goals have been written with this feature.

## Budgets and pauses

- The registered agent's `maxTurns` bounds each session. Core counts continuations after the
  initial response, so `maxTurns: 50` allows up to 51 model turns.
- `maxTotalModelTurns` counts new main-model operations across all sessions, including failed
  operations. Each child's allowance is capped by the remaining goal budget. Recovery and
  approvals never replenish it. Provider retries reuse one operation; this is not a count of
  billed requests. Compaction calls do not consume main-model turns.
- `maxTotalTokens` counts committed session usage, including compaction, and is checked before
  admitting the next session. An active session can exceed it. Uncommitted usage from interrupted
  requests cannot be reconstructed, so this is not a strict provider-spend cap.
- `deadline` is an absolute ISO UTC admission deadline, checked before new sessions, including
  after restart. It does not interrupt running sessions or approval waits.
- `maxSessions` is required and cannot exceed 999: the existing ownership tree allows 1000 nodes.
- `maxConsecutiveNoProgressSessions` counts consecutive assessments whose `progressKey` is
  unchanged from the previous assessment. The first assessment establishes the baseline.
  Choose an application-verified marker; model-generated summaries are not reliable progress
  detection. Oscillating markers are still bounded by the overall session/turn limits.

Budget exhaustion, stalled progress, an assessor's `blocked` decision, or an ordinary session
failure puts the goal into a persisted signal wait and frees execution capacity. The task's
checkpoint records `pauseReason` and cumulative totals. Approvals and uncertain tool effects
keep their child waiting for the existing `run.respond()` / `run.resolveTool()` protocols;
the controller never bypasses them by launching another session.

Inspect the pause and send its exact signal name with a deduplicated request ID:

```ts
const { task } = await goal.snapshot();
if (task.wait?.type === "signal") {
  await goal.signal(task.wait.name, "operator-decision-42", {
    feedback: "The dependency is available; continue with the increased budget.",
    limits: {
      maxSessions: 150,
      maxTotalModelTurns: 15_000,
      maxConsecutiveNoProgressSessions: 3,
    },
  });
}
```

A resume delivery is validated with `goalResumeSchema`. Optional `limits` replaces the whole
limit configuration; omission retains it. Counts never reset. The stall counter resets on
explicit resume. If limits are still exhausted the goal pauses again. Invalid deliveries expose
a new signal name because an existing delivery is immutable. A resumed ordinary failure starts
a new session; inspect the failed run's committed work and supply appropriate feedback first.

The goal checkpoints session indices and uses stable child/effect keys, so interrupted spawns,
assessments, and rollover reuse their committed identities. A child hitting its turn budget
remains `failed` for existing run APIs, with `run.exhaustion.reason === "max_turns"` and a partial
message transcript. The controller can assess that work and continue. Other errors are never
silently classified as exhaustion. `ctx.spawnAgent()` also accepts a lower `maxModelTurns` cap,
and `ctx.agentRun(childId)` reads only a direct owned agent child.

Use the normal task HTTP endpoints for remote submission, snapshots, signals, and cancellation;
the goal definition is registered as a task. This API adds no Studio UI or separate goal routes.
Definitions and agent implementations must remain compatible across recovery; change names/IDs
for incompatible policies. SQLite schema 7 adds exhaustion records and upgrades schemas 1–6 on
acquisition. Back up before upgrading; older engines reject schema 7. The runtime remains one
supervised process per local SQLite database.
