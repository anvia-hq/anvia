---
"@anvia/core": minor
---

Add `handler` to `createTool()` as the tool implementation. `execute` keeps working with the same signature but is deprecated and will be removed in the next major release. Pass exactly one of them: setting both, or neither, throws a `TypeError`.
