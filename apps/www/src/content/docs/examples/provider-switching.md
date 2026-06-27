---
title: Provider Switching
description: A pattern for using multiple model providers without rewriting product workflows.
section: examples
sidebar:
  group: Runtime and Integration
  order: 3
---

Provider switching belongs at the model selection boundary, not throughout product workflow code. Runners should receive a model with the capabilities they need; they should not know every provider-specific option.

## Scenario

Support chat uses OpenAI `gpt-5.5` by default. Internal escalation uses Anthropic `claude-opus-4.8`. A request with a PDF must choose a model path that supports document file input before building the prompt.

## Flow

| Step | Boundary |
| --- | --- |
| create provider clients | application startup |
| map use cases to models | model registry |
| check capabilities before prompt build | runner |
| record selected provider/model | trace metadata |
| test each configured model path | provider smoke tests |

## Example

```ts
import { AnthropicClient } from "@anvia/anthropic";
import { OpenAIClient } from "@anvia/openai";

const openai = new OpenAIClient({
  apiKey: process.env.OPENAI_API_KEY,
});

const anthropic = new AnthropicClient({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export const models = {
  supportDefault: openai.completionModel("gpt-5.5"),
  documentCapable: openai.completionModel("gpt-5.5"),
  escalationJudge: anthropic.completionModel("claude-opus-4.8"),
};

export function selectSupportModel(input: SupportModelInput) {
  if (input.attachments.some((file) => file.mediaType === "application/pdf")) {
    return models.documentCapable;
  }

  if (input.channel === "internal-escalation") {
    return models.escalationJudge;
  }

  return models.supportDefault;
}
```

The runner does not change shape:

```ts
const model = selectSupportModel({
  channel: input.channel,
  attachments: input.attachments,
});

if (input.attachments.length > 0 && !model.capabilities.documentInput) {
  return { ok: false, error: "model_does_not_support_documents" };
}

const agent = createSupportAgent({
  model,
  user,
  services: input.services,
});

const response = await agent
  .prompt(input.message)
  .withTrace({
    name: "support-chat",
    userId: user.id,
    metadata: {
      provider: model.provider,
      model: model.defaultModel,
      channel: input.channel,
    },
  })
  .send();
```

## Production Checks

- Provider-specific params are set at model construction or request boundary, not scattered through business logic.
- Capability checks happen before adding unsupported files, schemas, or tools.
- Smoke tests cover streaming, tools, schemas, document input, and fallback behavior for each configured model id.
- Traces record selected provider and model id.

## Failure Modes

- Provider-specific options leak into every runner.
- Capability checks happen after building prompts with unsupported content.
- Fallback model changes tool behavior without tests.
- Traces do not record selected provider or model.

## Next Patterns

- [Agent Runtime Composition](/docs/examples/agent-runtime-composition)
- [Testing Harness](/docs/examples/testing-harness)
- [Production Readiness](/docs/examples/production-readiness)
