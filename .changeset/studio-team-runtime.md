---
"@anvia/studio": minor
"@anvia/core": minor
---

Register AgentTeam targets in Studio and expose attributed JSONL team runs, coordinator
steering, cancellation, and application-only interaction responses scoped to each active run.
Cancel disconnected runs and clean up pending interactions on completion or shutdown.
Emit AgentTeam agent_queued events when instances are spawned, before they acquire a concurrency slot.
