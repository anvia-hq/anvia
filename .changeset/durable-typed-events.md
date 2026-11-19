---
"@anvia/durable": minor
---

Add typed durable events: `isDurableEvent(event, "model_delta", ...)` narrows a `DurableEvent` by type and types its payload, with `DurableEventPayloads`, `DurableEventOf`, and `DurableEventType` exported. `DurableEvent` itself is unchanged, so existing code keeps compiling. The guard checks the type tag only and does not validate payloads.
