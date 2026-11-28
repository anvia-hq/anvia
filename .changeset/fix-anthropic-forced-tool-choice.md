---
"@anvia/core": patch
"@anvia/anthropic": patch
---

Add optional `forcedToolChoice` capability to `CompletionModelCapabilities`, fall back to `toolChoice: "auto"` in `extract()` (and LLM eval judges) when `forcedToolChoice === false`, and mark Claude 5.5 / Fable 5.1+ / Mythos 5.1+ Anthropic models with `forcedToolChoice: false`.
