---
"@anvia/durable": minor
---

Add `context: { mode: "recorded" }` to the registration. It admits an agent with a live `VectorContext`: each retrieval is recorded before the model call and reused on replay, and the context settings are fingerprinted per run.
