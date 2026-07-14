---
"@anvia/openai": patch
---

Reject invalid Chat Completions streaming tool indices, isolate the primary completion choice, and fail safely when a streamed tool call ends without valid terminal metadata.
