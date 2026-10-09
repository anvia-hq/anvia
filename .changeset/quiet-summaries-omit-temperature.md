---
"@anvia/core": patch
---

Allow `createSummaryMemoryCompactor({ temperature: null })` to omit temperature from summary
model requests, including durable mid-tool-loop compaction. Omitted or undefined temperature
continues to default to 0; explicit finite numbers are forwarded unchanged.
