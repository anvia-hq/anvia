---
"@anvia/core": patch
"@anvia/memory-sqlite": patch
"@anvia/memory-postgres": patch
"@anvia/memory-drizzle": patch
"@anvia/memory-prisma": patch
"@anvia/studio": patch
---

Preserve canonical memory messages during compaction and store the latest summary as a separate
model-context checkpoint. Memory loads and inspection now remain fully replayable, while compacted
model requests receive the summary plus only the unsummarized tail.
