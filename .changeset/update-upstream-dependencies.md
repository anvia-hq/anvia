---
"@anvia/anthropic": patch
"@anvia/browser": patch
"@anvia/core": patch
"@anvia/gemini": patch
"@anvia/graph": patch
"@anvia/grok": patch
"@anvia/langfuse": patch
"@anvia/mistral": patch
"@anvia/neo4j": patch
"@anvia/openai": patch
"@anvia/react-ui": patch
"@anvia/sandbox": patch
"@anvia/studio": patch
---

Update upstream runtime dependencies and align SDK, React, and schema dependencies across the workspace. Update the browser image and host Playwright pins together to 1.63.0. Schema peers now require Zod ^4.6.5 and, for core's optional Valibot adapter, @valibot/to-json-schema ^1.8.0.
