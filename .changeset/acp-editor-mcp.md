---
"@anvia/acp": minor
"@anvia/mcp": minor
---

Connect editor-supplied stdio MCP servers per ACP session with automatic protocol fallback,
validated declarations, deterministic tool prefixes, once-only approvals, and teardown on
setup failure or session close. Add opt-in Streamable HTTP with exact endpoint trust and
pinned host-approved addresses while preserving strict SSRF checks for other URLs.
Keep redirect behavior unchanged for plain HTTP connections; reject redirects for endpoints
with configured headers or trusted addresses.

Show editor terminal commands, quoted arguments, and resolved working directories in approval
requests, with sanitized full text and visibly truncated titles.

Reject case-insensitive duplicate MCP HTTP headers and await the original transport close
during aborted connection rollback so stdio children have exited before cleanup completes.
