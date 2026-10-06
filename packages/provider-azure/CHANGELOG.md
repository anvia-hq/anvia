# @anvia/azure

## 0.1.0

### Minor Changes

- 09d8621: Add a dedicated AzureOpenAIClient for Azure OpenAI and Foundry v1 endpoints with API-key
  or Entra token authentication, injected SDK support, and Azure provider identities.
  Move Azure Responses function-name recovery and the opt-in Azure integration test into
  the new provider package. Expose the reusable Responses model through `@anvia/openai/adapters`
  with request-mapping and stream-normalization extension points, while keeping OpenAI's parser responsible
  for native events, including unnamed argument events without synthesizing a name.
  Completed tool calls remain validated. Existing OpenAIClient custom endpoints remain supported;
  use AzureOpenAIClient when Azure event normalization is needed.

  Azure Responses requests include explicit message types for Foundry project endpoints,
  while preserving function-call and tool-result item shapes.

### Patch Changes

- Updated dependencies [09d8621]
  - @anvia/openai@1.2.0
