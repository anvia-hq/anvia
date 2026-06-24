---
"@anvia/langfuse": minor
---

Forward every streaming delta to Langfuse via
`generation.update({ output: { delta } })`, so dashboards reflect
partial output as the model produces it. Supported delta types:
`text_delta`, `reasoning_delta`, and `tool_call`.
