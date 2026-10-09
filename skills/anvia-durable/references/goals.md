# Goals across sessions

Use `defineGoal({ name, version, agentId, assess })`, register the result in
`DurableRuntime.open({ tasks: [goal], agents, store })`, then call
`runtime.submitGoal(goal, { sessionId, requestId, objective, acceptanceCriteria, limits })`.
The handle is a normal durable task: inspect `snapshot()`/`graph()`, stream tree events,
cancel the tree, and reacquire it with `runtime.getTask(id)` after restart.

Required limits are `maxSessions` (1–999), `maxTotalModelTurns`, and
`maxConsecutiveNoProgressSessions`. Optional `maxTotalTokens` and ISO UTC `deadline`
are admission checks between sessions, not hard interrupts or exact billing caps.
The registered agent's `maxTurns` still bounds each child; a lower remaining goal
allowance caps it. Main-model operations count across approvals and restarts;
provider retries reuse an operation and compaction calls consume tokens, not model turns.

`assess({ objective, acceptanceCriteria, previous, session }, signal)` must be a read-only,
repeatable application verifier. `session` includes `runId`, `status` (`response` or
`exhausted`), `output`, `messages`, `modelTurns`, and `usage`. Return a validated decision:
`{ status: "continue" | "complete" | "blocked", summary, next, progressKey, evidence }`.
Verify completion independently of the agent's claim and derive `progressKey` from
observed artifacts or tests. Hidden model calls inside the assessor are not owned or
budgeted by the runtime. The journal reuses a committed decision; unfinished verification
can repeat after a crash. Keep the same policy implementation across recovery.

The next session receives the original objective/criteria, verified handoff, and operator
feedback. It does not automatically inherit the full transcript. Include necessary artifact
references and next steps in the handoff. Existing compaction works within each child.

Budget/stall/blocker/ordinary-failure pauses expose `task.wait` as a signal and a typed
`pauseReason` in the checkpoint. Resume with the exact exposed signal name and a stable
request ID, sending `{ feedback, limits? }`. Limits replace the entire configuration;
cumulative counters never reset. Repeated no-progress counting resets only on explicit
resume. Invalid deliveries expose a fresh signal name. Approvals and uncertain tool
effects must still be resolved on the child run, never by bypassing it with a new session.

`maxTurns` exhaustion preserves `run.exhaustion` with reason `max_turns` and partial messages;
the child remains failed for compatibility with run APIs. Generic failures require explicit
attention. Goals use stable owned-child/effect keys across interrupted rollover. The feature
uses SQLite schema 7; schemas 1–6 upgrade on acquisition and older engines reject schema 7.
No separate goal HTTP routes or Studio UI are added; use existing custom-task endpoints.
