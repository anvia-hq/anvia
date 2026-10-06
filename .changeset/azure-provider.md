---
"@anvia/azure": minor
"@anvia/openai": minor
---

Add a dedicated AzureOpenAIClient for Azure OpenAI and Foundry v1 endpoints with API-key
or Entra token authentication, injected SDK support, and Azure provider identities.
Move Azure Responses function-name recovery and the opt-in Azure integration test into
the new provider package. Expose the reusable Responses model through `@anvia/openai/adapters`
with request-mapping and stream-normalization extension points, while keeping OpenAI's parser responsible
for native events, including unnamed argument events without synthesizing a name.
Completed tool calls remain validated. Existing OpenAIClient custom endpoints remain supported;
use AzureOpenAIClient when Azure event normalization is needed.

Azure Responses requests include explicit message types for Foundry project endpoints,
while preserving function-call and tool-result item shapes.
