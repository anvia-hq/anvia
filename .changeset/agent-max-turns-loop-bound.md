---
"@anvia/core": patch
---

Enforce exact `maxTurns` boundary in agent execution loop. The agent loop now stops after the configured turn limit rather than allowing extra completion attempts.
