---
"@anvia/core": patch
---

Reject a provider tool whose configuration is not JSON. Agent construction and completion requests now throw a `TypeError` that names the tool, instead of sending the malformed entry to the local tool list where it was silently dropped.
