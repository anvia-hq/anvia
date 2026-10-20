---
"@anvia/server": patch
---

Validate the resumable stream `after` cursor as a nonnegative safe integer. Invalid cursors now return a typed 400 error instead of silently returning all or no records with a normal end envelope.
