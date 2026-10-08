---
"@anvia/openai": minor
"@anvia/core": minor
"@anvia/azure": patch
"@anvia/grok": patch
---

Add OpenAI decision models through `OpenAIClient.decisionModel()`, with native choice, score,
and predicate mappings and composed independent multi-label checks. Export decision model-ID
and handle types plus `GPT_6_LUNA`. Upgrade the OpenAI SDK minimum to 7.30.0 for Decisions support.
Validate response identities, distributions, rubric labels, and token usage while preserving
provider confidence and raw responses. Encode structured state and criteria as text, disable SDK
retries, and use Core retries, cancellation, and ordered batches.

Add the provider-neutral `DecisionRefusalError` with refused application question names and the
raw provider response. Refusals fail a complete decision without changing successful answer types.
Document mappings, limitations, and refusal handling in package guides; external documentation
should add OpenAI to the decision-provider catalog and describe the new error export.

Align the Azure and Grok adapters on OpenAI SDK 7.30.0 because they share SDK clients
and delegate to the OpenAI adapter. This preserves SDK client-type compatibility across adapters.
