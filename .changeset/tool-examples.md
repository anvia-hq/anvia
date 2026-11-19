---
"@anvia/core": minor
---

Add `examples` to `createTool()`. Each example is an input, validated against the tool's `inputSchema` when the tool is created, and an optional note; they render into the tool definition's description as `name({"arg":1}) note` lines.

This matters most for retrieved tools: a tool index hands the model a schema for a tool it has never seen, and a worked call for the common case is what keeps the call shape right. Examples render on static definitions too, which costs prompt tokens on every turn, so keep the list short.
