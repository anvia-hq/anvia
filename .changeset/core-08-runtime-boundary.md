---
"@anvia/core": patch
---

Copy Standard Schema converter data before provider strict-object refinement. Cached and frozen schemas remain reusable, and aliased literal values remain unchanged. Reject cyclic or unsupported converter data with a TypeError before calling a model.
