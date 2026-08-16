---
"@anvia/core": patch
"@anvia/openai": patch
"@anvia/anthropic": patch
"@anvia/gemini": patch
"@anvia/mistral": patch
"@anvia/grok": patch
"@anvia/transformers": patch
"@anvia/fastembed": patch
"@anvia/client": patch
"@anvia/react": patch
"@anvia/studio": patch
"@anvia/langfuse": patch
"@anvia/otel": patch
"@anvia/logger": patch
---

Bind provider and local-model handles to explicit model IDs, make remote provider factories
object-only, and introduce honest local loading and ownership boundaries.
