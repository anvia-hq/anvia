---
"@anvia/langfuse": minor
---

Record extra data on Langfuse observations so the UI shows everything
the agent runtime emits.

- Generation observations now carry `providerRequest` and `modelInfo`
  on start, and `firstDeltaMs` on end.
- Tool observations now carry `toolDefinition` and `toolMetadata` on
  start, and `structuredResult` on end.
- `usageDetailsFromRecord` now consistently includes
  `cachedInputTokens` and `cacheCreationInputTokens` to match the
  main `usageDetails` helper.
