---
"@anvia/anthropic": minor
---

Add Anthropic prompt caching. `client.completionModel({ modelId, promptCache: true })` places ephemeral cache breakpoints on the last tool definition, the system prompt and the last cacheable block of the conversation, so a later turn reads the input prefix from cache. `promptCache: { ttl: "1h" }` uses the extended cache. The same breakpoints are available for hand-built Messages params through `withAnthropicPromptCache(params, options)`, and the existing usage mapping already reports `cachedInputTokens` and `cacheCreationInputTokens`.
