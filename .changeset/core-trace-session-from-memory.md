---
"@anvia/core": patch
---

Default a run's trace `sessionId` and `userId` to its memory `session`, so multi-turn conversations group into one session in Lens, Langfuse and OpenTelemetry. An explicit `trace.sessionId` or `trace.userId` still wins.
