---
"@anvia/core": minor
---

`toolConcurrency` is now applied per turn. An agent with a question tool or a tool that may require approval used to run every tool call in order. Now only a turn that calls such a tool runs in order, so it can still suspend and resume. Other turns of the same agent run their tool calls concurrently. Runs with an active internal hook stay ordered.
