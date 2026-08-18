---
"@anvia/core": patch
"@anvia/logger": patch
---

Accept only complete outer JSON Markdown fences as a strict structured-output compatibility
fallback, retry Agent parsing and schema failures within the configured total-attempt budget, and
surface phase-aware errors without embedding rejected output. Preserve nested Error cause details
in logger observer records with bounded traversal and redact parser/schema causes that may contain
rejected structured output.
