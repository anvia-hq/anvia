---
"@anvia/milvus": patch
---

Validate metadata filter keys before building Milvus Boolean expressions. Filter keys must be plain
identifiers (letters, digits, underscores, and dots for nested fields), must not use reserved
expression keywords as path segments, and numeric filter values must be finite. Searches with
hostile filter input now fail fast with a descriptive error instead of forwarding attacker-shaped
strings to Milvus.
