---
"@anvia/core": patch
---

Add an internal execution hook that wraps each model call's tool selection, so a durable runtime can record and replay tool-index results. The public API is unchanged.
