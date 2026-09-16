---
"@anvia/studio": patch
"@anvia/react-ui": patch
---

Show response actions and metrics only on the final assistant response of each completed exchange, hiding them on intermediate turns and while streaming.

Apply the same final-response visibility to the shared Message.Actions group.

Keep fallback run metrics aligned with user exchanges even when an earlier exchange has no final assistant reply.
