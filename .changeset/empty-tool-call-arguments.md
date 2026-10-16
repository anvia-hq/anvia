---
"@anvia/core": patch
"@anvia/openai": patch
"@anvia/mistral": patch
---

Treat empty or whitespace-only tool-call argument strings as `{}` instead of failing with `malformed-tool-arguments`, so zero-argument tool calls from OpenAI-compatible backends (OpenRouter, Ollama, vLLM) and Mistral succeed. Malformed non-empty JSON arguments are still rejected.
