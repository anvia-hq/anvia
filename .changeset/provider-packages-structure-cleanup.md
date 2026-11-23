---
"@anvia/core": minor
"@anvia/anthropic": patch
"@anvia/azure": patch
"@anvia/gemini": patch
"@anvia/grok": patch
"@anvia/jev": patch
"@anvia/mistral": patch
"@anvia/openai": patch
---

Extract shared internal provider utilities into `@anvia/core/internal/provider`, decompose monolithic provider completion/decision modules into request, response, stream, and model-listing modules, align provider package structure and single-source-of-truth model controls, and guard against non-object responses in embedding, image generation, and transcription adapters.
