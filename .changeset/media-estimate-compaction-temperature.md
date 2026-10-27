---
"@anvia/core": patch
---

Count inline image and file data as a bounded amount in `estimateMemoryTokens`, so one pasted screenshot no longer triggers premature compaction. `createSummaryMemoryCompactor` now sends no `temperature` unless one is set, so models that reject the parameter no longer fail compaction. `MemoryCompactionError` now includes the provider's error message when the summary request fails.
