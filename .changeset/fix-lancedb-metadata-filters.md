---
"@anvia/core": patch
"@anvia/lancedb": patch
---

Apply LanceDB metadata filters through Core's provider-neutral matcher instead of generating SQL
against the adapter's serialized metadata column. This fixes filtering with LanceDB 0.37, prevents
filter keys or values from becoming SQL, and removes the unsupported `filterToLanceExpr` export.
