---
"@anvia/logger": patch
---

Clean up failed asynchronous file destinations so Pino does not throw during process shutdown. Preserve the original file-open error for subsequent flush calls, including child loggers.
