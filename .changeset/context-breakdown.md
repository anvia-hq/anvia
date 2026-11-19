---
"@anvia/core": minor
"@anvia/studio": minor
---

Add a context breakdown: `@anvia/core/context` splits an assembled request into the buckets that spend input tokens (instructions, messages, tool results, documents, tool definitions, MCP tools, provider tools, output schema) with `estimateContextBreakdown`, and `scaleContextBreakdown` rescales the split so its segments add up to the provider's reported input tokens. Agent runs pass the estimate through `AgentGenerationStartArgs.context` and the scaled split through `AgentGenerationEndArgs.context`. Studio records it per generation and shows a **Context** panel in the trace inspector plus a compact split in the playground's response metrics.
