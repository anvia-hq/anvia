---
"@anvia/durable": patch
---

Serialize each payload once per limit check.

- A completed task output is measured once. The change check used to serialize the whole outcome,
  and the size check then serialized the output again.
- Every value is serialized at most once per check, and the change check and size check share that
  string. No stored format or limit changes. Status events are still not payload-checked.
