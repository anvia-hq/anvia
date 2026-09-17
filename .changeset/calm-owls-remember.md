---
"@anvia/core": minor
---

Add deterministic `recentTurns` memory-compaction retention and retain deprecated `recentTokens`
behavior as an explicit migration path. This changes omitted retention from a token budget of 25%
of `afterTokens` to one complete user-led turn.
