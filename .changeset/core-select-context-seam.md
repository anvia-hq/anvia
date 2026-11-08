---
"@anvia/core": patch
---

Add an internal `selectContext` step to the agent run execution seam so a durable runtime can record and replay vector context retrievals. The execution protocol version is now 5. Public API is unchanged.
