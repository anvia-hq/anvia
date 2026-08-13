---
"@anvia/react": patch
"@anvia/server": patch
"@anvia/studio": patch
---

Use the consumer's `@anvia/core` installation from React and Server so Studio targets do not
resolve incompatible Agent and Pipeline class declarations from nested Core versions.
