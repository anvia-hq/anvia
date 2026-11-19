---
"@anvia/durable": minor
---

Add automatic registration versions: `version: "auto"` in `DurableRuntime.open()` or `DurableWorker.start()`, and `agentVersion(agent)` for other paths, derive the version from the agent's model, instructions, sampling settings, tool definitions and output schema. A run recorded under one configuration is refused with an explanatory message if the configuration changed before it finished. Tool implementations, guardrails, middlewares and lifecycle hooks are not covered. Explicit versions behave as before.
