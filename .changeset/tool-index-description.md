---
"@anvia/core": minor
---

`ToolIndex` can describe itself: `createToolIndex()` sets optional `embeddingModel` and `embeddedDocuments` (each tool's id and the text that was embedded), and the agent's registered snapshot keeps them.

This closes a durable hole. The tool-index fingerprint hashed the search settings and tool definitions but not the embedding model or the embedded text, so changing the model, the `content` callback, or `embeddingText` under one registration version replayed a stale recorded selection silently. The docs told users to bump the version by hand instead.
