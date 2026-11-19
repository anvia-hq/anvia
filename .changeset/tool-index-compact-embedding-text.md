---
"@anvia/core": minor
---

Add `embeddingText: "compact"` to `createToolIndex()` and `embedTools()`. The compact mode embeds a tool's name, description, parameter names and `describe()` text instead of the stringified JSON schema, so a query shares more words with the tool and the identical schema scaffolding no longer dilutes the vector. It only reads `properties` keys and their `description`, so an output schema rendered into the same slot cannot make a tool retrievable by its result fields.

The full-definition text stays the default: switching it silently would re-rank every existing `ToolIndex`, and `content` still overrides both modes.
