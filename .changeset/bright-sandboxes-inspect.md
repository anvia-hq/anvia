---
"@anvia/sandbox": patch
"@anvia/studio": patch
---

Automatically expose sandbox-backed agent workspaces in Studio through read-only APIs and a
dedicated Sandboxes inspector. Studio servers can also leave SIGINT handling to the application or
use the managed `serve(...)` lifecycle to await asynchronous resource cleanup.
