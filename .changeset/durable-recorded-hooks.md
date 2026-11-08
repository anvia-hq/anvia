---
"@anvia/durable": minor
---

Add `hooks: { mode: "record", hook }` to the registration. It admits a core control hook (`onToolCall` skip, terminate and approval request, `onRunStart` and `onCompletionCall` cancel) and records each decision before it is applied, so a restart or retry reuses it and never calls the hook again.
