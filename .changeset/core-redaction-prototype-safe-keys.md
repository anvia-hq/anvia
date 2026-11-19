---
"@anvia/core": patch
---

Keep redacted objects from adopting a `__proto__` payload as their prototype, so a redacted copy always has an ordinary object prototype.
