---
"@anvia/studio": patch
---

Guard the playground while a run is suspended waiting for approval or a question. Composer submit, new chat, agent switch, and session load/delete are now blocked until the pending interaction is answered, so a new prompt can no longer clear pending interactions and orphan the server-side suspended run.
