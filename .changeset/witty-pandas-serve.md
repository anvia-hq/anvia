---
"@anvia/studio": patch
---

The Studio knowledge inspector now validates static-context cursors with the shared `parseVectorInspectCursor` parser and returns a `400 bad_request` ("Invalid cursor") response for invalid cursors instead of silently replaying the first page.
