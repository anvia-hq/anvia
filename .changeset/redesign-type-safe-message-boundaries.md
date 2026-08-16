---
"@anvia/core": patch
"@anvia/client": patch
"@anvia/server": patch
"@anvia/react": patch
"@anvia/react-ui": patch
"@anvia/studio": patch
"@anvia/openai": patch
"@anvia/anthropic": patch
"@anvia/gemini": patch
"@anvia/mistral": patch
"@anvia/grok": patch
"@anvia/memory-postgres": patch
"@anvia/memory-sqlite": patch
"@anvia/memory-drizzle": patch
"@anvia/memory-prisma": patch
"@anvia/langfuse": patch
"@anvia/otel": patch
---

Replace message factories with strict JSON-safe structural messages, add canonical Core and UI
parsers, move custom data validation to typed transports, and adopt the `anvia.client.v2` framed
protocol. Make Client and Server calls object-only, make React transport-only with standalone
completion state, and require canonical structural message requests in Studio.
