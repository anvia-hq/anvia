---
"@anvia/durable": minor
---

Admit agent memory behind an explicit marker (parity phase 7).

- Registration accepts `memory: { mode: "recorded" }`. Without it, memory is still rejected, and the error names the `memory` field and the marker.
- The run reads the memory store once, before the first model call, and reuses that snapshot on replay.
- Each write is a `memory` operation keyed by an idempotency key the runtime derives from the run and the write's position. Writes run after the terminal checkpoint, and a crash before they finish keeps the run open until they do.
- A concurrent change to the memory history fails the run with `needs_attention` and writes nothing.
- Rejected under the marker: `memory.compaction`, and a store without `loadVersioned()`. A run that pauses for a human interaction fails under the marker. Adapter packages do not implement the versioned contract yet.
