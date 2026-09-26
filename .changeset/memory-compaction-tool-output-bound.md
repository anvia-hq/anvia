---
"@anvia/core": patch
---

Bound tool results in memory compaction prompts. `createSummaryMemoryCompactor`
already capped inline file text (`MAX_FILE_TEXT_CHARS`), but tool results were serialized
in full: a large text or JSON tool output was embedded verbatim into the compaction
prompt, which could overflow the compaction model's context and inflate token cost.
Tool output is now truncated with the same `[truncated N chars]` marker used for file
text, so compaction prompts stay bounded.
