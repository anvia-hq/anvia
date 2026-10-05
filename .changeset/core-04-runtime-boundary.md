---
"@anvia/core": patch
---

Preserve terminal metadata, including context usage and source or provider-tool updates, when a completion stream ends with an empty terminal choice. Accumulated content and message ID fallback remain available without replacing terminal metadata.
