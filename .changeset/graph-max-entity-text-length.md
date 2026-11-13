---
"@anvia/graph": minor
---

Add `maxEntityTextLength` to the ingestion options. It truncates the text embedded for each entity, for `defaultGraphEntityText` and for a custom `entityText` function, so a property-heavy entity cannot exceed the embedding model's input limit. Chunk text is unchanged.
