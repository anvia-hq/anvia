---
"@anvia/core": patch
---

Fix Responses API stream finalization when empty or encrypted reasoning arrives only in the final response, including Azure Responses streams. Preserve encrypted reasoning for subsequent turns and allow final-only encryption to enrich matching streamed reasoning while continuing to reject conflicting text, reasoning, and tool calls.
