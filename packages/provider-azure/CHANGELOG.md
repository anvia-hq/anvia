# @anvia/azure

## 0.1.7

### Patch Changes

- Updated dependencies [978458e]
  - @anvia/openai@1.3.5

## 0.1.6

### Patch Changes

- Updated dependencies [068e15c]
  - @anvia/openai@1.3.4

## 0.1.5

### Patch Changes

- Updated dependencies [c9db6a4]
  - @anvia/openai@1.3.3

## 0.1.4

### Patch Changes

- Updated dependencies [3f1e8c1]
  - @anvia/openai@1.3.2

## 0.1.3

### Patch Changes

- 77d47c9: Require HTTPS for non-loopback Azure OpenAI endpoints. `endpoint` and `baseUrl` now reject plain
  `http://` URLs unless the host is a loopback development target (`localhost`, `127.0.0.1`, or
  `[::1]`), so API keys are never sent over cleartext to remote hosts. Existing `https://`
  configurations and local emulator setups such as `http://127.0.0.1:10000` keep working unchanged.
  - @anvia/openai@1.3.1

## 0.1.2

### Patch Changes

- 8b1bd1a: Update runtime dependencies to the latest compatible minor and patch releases.
- Updated dependencies [8b1bd1a]
  - @anvia/openai@1.3.1

## 0.1.1

### Patch Changes

- 603d652: Add OpenAI decision models through `OpenAIClient.decisionModel()`, with native choice, score,
  and predicate mappings and composed independent multi-label checks. Export decision model-ID
  and handle types plus `GPT_6_LUNA`. Upgrade the OpenAI SDK minimum to 7.30.0 for Decisions support.
  Validate response identities, distributions, rubric labels, and token usage while preserving
  provider confidence and raw responses. Encode structured state and criteria as text, disable SDK
  retries, and use Core retries, cancellation, and ordered batches. Reject requests above OpenAI's
  10 rubric levels or 200 questions, counted after multi-label expansion, before network work.

  Add the provider-neutral `DecisionRefusalError` with refused application question names and the
  raw provider response. Refusals fail a complete decision without changing successful answer types.
  Document mappings, limitations, and refusal handling in package guides; external documentation
  should add OpenAI to the decision-provider catalog and describe the new error export.

  Align the Azure and Grok adapters on OpenAI SDK 7.30.0 because they share SDK clients
  and delegate to the OpenAI adapter. This preserves SDK client-type compatibility across adapters.

- Updated dependencies [603d652]
  - @anvia/openai@1.3.0

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
