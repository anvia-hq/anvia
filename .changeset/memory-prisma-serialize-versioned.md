---
"@anvia/memory-prisma": patch
---

Serialize keyed and versioned appends on the session row. Writers racing on one `expectedVersion` could all commit, and a keyed write racing itself could fail with a unique-constraint error. They now get one `committed` and the rest `conflict` or `duplicate`. Plain appends are unchanged.
