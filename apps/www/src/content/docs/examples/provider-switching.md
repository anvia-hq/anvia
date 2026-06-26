---
title: Provider Switching
description: The pattern for using multiple model providers without rewriting the app.
section: examples
sidebar:
  group: Runtime and Integration
  order: 3
---

Provider switching belongs at the model selection boundary, not throughout the product workflow.

## Scenario

Support chat uses a fast model by default, but falls back to a model with document input when the request includes a PDF.

## Example

```ts
export function selectSupportModel(input: SupportModelInput) {
  if (input.attachments.some((file) => file.kind === "pdf")) {
    return models.documentCapable;
  }

  if (input.channel === "internal") {
    return models.highReasoning;
  }

  return models.fastDefault;
}
```

The runner does not change shape:

```ts
const model = selectSupportModel({
  channel: input.channel,
  attachments: input.attachments,
});

const agent = createSupportAgent({
  model,
  user,
  services: input.services,
});
```

## Failure Modes

- Provider-specific options leak into every runner.
- Capability checks happen after building prompts with unsupported content.
- Fallback model changes tool behavior without tests.
- Traces do not record selected provider or model.

## Next Patterns

- [Agent Structure](/docs/examples/agent-structure)
- [Testing Harness](/docs/examples/testing-harness)
