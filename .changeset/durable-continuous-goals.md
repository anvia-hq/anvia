---
"@anvia/durable": minor
"@anvia/client": patch
"@anvia/server": patch
---

Add continuing goal rounds. `defineGoal({ rounds: "continue" })` keeps one conversation across a goal's sessions: each session after the first continues the previous session's conversation, including a turn-limited session's partial work, with a short continuation prompt. Assessors receive `session.roundMessages` with only the round's own messages, so an application can let the agent declare completion itself. Owned agent children accept `continueFrom` to continue a finished sibling's conversation. The default `rounds: "fresh"` is unchanged. `@anvia/client` and `@anvia/server` accept `@anvia/durable` 0.10.
