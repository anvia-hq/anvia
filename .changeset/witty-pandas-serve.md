---
"@anvia/studio": patch
---

The Studio knowledge inspector now returns a `400 bad_request` ("Invalid cursor") response for invalid cursors on every inspectable knowledge source (static context, dynamic context, and dynamic tools). Invalid cursors on store-backed sources are identified via the new `VectorInspectCursorError` exported from `@anvia/core/vector-store` instead of silently replaying the first page or failing with a server error.
