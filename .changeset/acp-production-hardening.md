---
"@anvia/acp": minor
---

Require explicit host opt-in and per-server approval for client stdio MCP launches. Confine editor
file and terminal paths to the session workspace unless the host adds editorWorkspaceRoots.
Add configurable concurrent request, terminal output and load replay limits, compact retained
text deltas, release cancelled SDK requests even without client replies, and audit error privacy
and cancellation cleanup ahead of ACP v2 support.
