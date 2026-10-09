---
"@anvia/durable": minor
"@anvia/client": patch
"@anvia/server": patch
---

Allow durable goals to select an agent per submission, with an optional definition-level
default. Capture the effective agent in the goal checkpoint and expose it to assessment code.
Validate registration before accepting submissions through both goal and task APIs.

Preserve legacy goal inputs and assessment journals across recovery. Missing registrations
between sessions now require attention and can be retried after re-registering the agent.
Extend the client and server peer ranges to accept the compatible durable 0.6 minor release.
