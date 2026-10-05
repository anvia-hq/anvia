---
"@anvia/core": patch
---

Cancel built-in skill scripts with their tool invocation. Wait for direct-child exit, escalate ignored termination signals, and clean up abort listeners and timers without changing normal output or timeout diagnostics. Closing an agent stream consumer now aborts the existing run signal before failure cleanup so active tools receive cancellation.
