---
"@anvia/core": patch
"@anvia/durable": patch
"@anvia/openai": patch
---

Port the aven-harness settled-history and model-pricing fixes into source. Durable sessions now continue from started failed/cancelled runs and carry their settled progress (exhaustion tail or latest context checkpoint) into the next run's history instead of dropping it. OpenAI model listing now preserves advertised `pricing` metadata alongside `reasoning`.
