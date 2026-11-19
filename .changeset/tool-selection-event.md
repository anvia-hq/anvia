---
"@anvia/core": minor
---

Add the `tool_selection` stream event: the tools a turn offered, plus every tool each tool index returned with its score and the index it came from.

Selection used to be invisible once the request was built, so "why wasn't my tool offered" could only be guessed at. The event fires only when the turn's text actually hit an index. A replayed durable turn reports the recorded selection with no matches, because it does not search again.

**Widens the `AgentStreamEvent` union**, which breaks a consumer that handles every variant exhaustively (`switch` with a `never` default, or a `Record<AgentStreamEvent["type"], ...>`). `@anvia/client` maps it through its existing custom-event fallback.
