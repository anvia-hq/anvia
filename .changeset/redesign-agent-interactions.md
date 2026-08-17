---
"@anvia/core": patch
"@anvia/client": patch
"@anvia/server": patch
"@anvia/react": patch
"@anvia/react-ui": patch
"@anvia/studio": patch
"@anvia/logger": patch
"@anvia/langfuse": patch
"@anvia/otel": patch
"@anvia/openai": patch
"@anvia/anthropic": patch
"@anvia/gemini": patch
"@anvia/mistral": patch
"@anvia/grok": patch
"@anvia/memory-sqlite": patch
"@anvia/memory-postgres": patch
"@anvia/memory-drizzle": patch
"@anvia/memory-prisma": patch
---

Replace process-local approval continuations and Studio-only questions with JSON-safe Agent
interactions resumed through `generate()` or `stream()`. Add first-class question tools, explicit
interaction response message parts, linked phase-local runs, suspension-aware nested composition,
queued steering receipts, and eval responders. Upgrade the Client protocol to v3, unify React and
Studio interaction handling, preserve suspensions through memory, traces, and resumable streams,
and reject unresolved interaction parts at provider boundaries.
