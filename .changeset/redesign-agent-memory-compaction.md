---
"@anvia/core": patch
"@anvia/client": patch
"@anvia/react": patch
"@anvia/studio": patch
"@anvia/memory-sqlite": patch
"@anvia/memory-postgres": patch
"@anvia/memory-drizzle": patch
"@anvia/memory-prisma": patch
---

Move durable memory selection onto the object-only Agent generate and stream boundaries, remove
AgentSession and positional execution signatures, and distinguish stateful prompts from stateless
transcripts. Replace implicit compaction summaries with explicit MemoryScope, store capability,
typed compaction-message, result metadata, and stream-event contracts. Persist compaction messages
atomically in every memory adapter and carry compaction events through Client, React, resumable
server streams, and Studio logs without creating synthetic chat messages.
