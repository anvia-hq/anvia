---
"@anvia/core": minor
---

Harden MCP HTTP and SSE connections against SSRF by validating and pinning DNS results for every
outbound origin, including redirects and OAuth metadata endpoints. Custom transport fetch
implementations are rejected so they cannot bypass these protections.
