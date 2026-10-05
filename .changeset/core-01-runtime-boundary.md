---
"@anvia/core": patch
---

Forward evaluation case cancellation through agent generation, approval resumes, embeddings, and judge retries. Preserve original invocation abort reasons, including explicit null. Keep shared G-Eval preparation alive for independent waiters, cancel it when the last waiter leaves, and preserve successful setup deduplication and usage attribution.

Preserve explicit null abort reasons through suite cancellation and retain shared preparation usage for the first valid scoring outcome when earlier scorers cancel or fail.
