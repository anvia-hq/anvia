---
"@anvia/langfuse": minor
---

Add an in-memory score queue with batched sends, exponential-backoff
retry, and a manual flush method.

- New `scoreBatchSize`, `scoreFlushIntervalMs` (default 250), and
  `scoreMaxRetries` (default 3) options on `LangfuseTracingOptions`.
  Setting `scoreBatchSize` enables the queue; the default is direct
  send.
- New `flushScores()` and `scoreQueueDepth()` methods on
  `LangfuseTracing`. `flush()` and `shutdown()` also drain the queue.
- Retries on 429 and 5xx with exponential backoff (200 ms base,
  2x factor, ±25% jitter, capped at 5 s). Other 4xx throw
  immediately.
- New `LangfuseScoreError` class. After all retries are exhausted,
  the error's `scores` property contains the failed payloads.
- New `LangfuseScoreDataType` type export.
