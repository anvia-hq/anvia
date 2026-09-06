---
"@anvia/core": patch
---

Preserve source-module boundaries in the ESM build and import Zod's JSON Schema converter directly so bundlers can remove unrelated schema initialization from lightweight consumers such as `createTool`. Public exports, type declarations, and runtime behavior are unchanged.
