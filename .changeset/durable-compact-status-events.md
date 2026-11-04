---
"@anvia/durable": minor
"@anvia/client": patch
"@anvia/server": patch
---

Keep `status` events small: they no longer embed the run's outcome.

- `@anvia/durable`: a `status` event carries `status`, `error`, `blockedOperation` and
  `nextAttemptAt`. The run's `outcome` is stored once, on the run, and is read from the run
  snapshot. Status events are not payload-checked, so a limit cannot block a run from reaching a
  terminal status. Journals written by older versions still carry `outcome` on the event, and
  clients still read it.
- `@anvia/client`: the durable chat transport reads the outcome from the snapshot when a settled
  (`completed`, `waiting`, `failed`) status event has none. If the run has already moved past that
  status, the event maps without an outcome. The chat output for completed, waiting and failed
  runs is unchanged.
- `@anvia/server`: peer range updated for `@anvia/durable` 0.14.
