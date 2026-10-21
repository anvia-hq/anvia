---
"@anvia/acp": minor
---

Add session stores with opt-in file persistence, safe history replay, silent resume, workspace-filtered pagination, close and delete. Preserve completed model context and tool presentation IDs across restarts without replaying private reasoning or rerunning historical tools.

Retain public tool presentation text and terminal command details during replay, reject malformed stored display fields, and prevent new tool IDs from colliding with uncommitted cards after resume.
