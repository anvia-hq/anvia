---
"@anvia/durable": minor
---

Add `context: { mode: "recorded" }` to the registration. It admits an agent with a live `VectorContext`: each retrieval is recorded before the model call and reused on replay, and the context settings are fingerprinted per run.

An oversized retrieved document set is stored in the blob table behind a whole-value reference, so one retrieval cannot exceed the operation payload limit. The peer dependency on `@anvia/core` now requires execution protocol 5 (`>=1.19.1 <2`), since the runtime refuses older core anyway.
