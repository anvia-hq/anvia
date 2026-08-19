---
"@anvia/core": patch
"@anvia/logger": patch
"@anvia/openai": patch
"@anvia/anthropic": patch
"@anvia/gemini": patch
"@anvia/mistral": patch
"@anvia/grok": patch
---

Preserve normalized and provider-native completion finish reasons across first-party adapters,
identify output-limit truncation before structured parsing, rebuild Agent repairs from the original
request with omitted or bounded text-only output, and log safe per-attempt retry diagnostics through
named observer events.
