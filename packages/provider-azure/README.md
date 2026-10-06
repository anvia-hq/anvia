# @anvia/azure

Connect Anvia agents to Azure OpenAI and Azure AI Foundry endpoints. Azure configuration
lives here; request and response mapping is shared with `@anvia/openai`.

## Install

```sh
pnpm add @anvia/azure @anvia/core
```

## Quickstart

```ts
import { Agent } from "@anvia/core";
import { AzureOpenAIClient } from "@anvia/azure";

const client = new AzureOpenAIClient({
  endpoint: process.env.AZURE_OPENAI_ENDPOINT!,
  apiKey: process.env.AZURE_OPENAI_API_KEY!,
});

const agent = new Agent({
  id: "assistant",
  model: client.completionModel({
    modelId: process.env.AZURE_OPENAI_DEPLOYMENT!,
    api: "responses",
  }),
});

const result = await agent.generate({ prompt: "Hello!" });
if (result.type === "response") console.log(result.output);
```

`endpoint` is the resource origin, such as `https://example.openai.azure.com`.
Use `baseUrl` instead for a full API URL, including Foundry project endpoints.
`modelId` is your Azure deployment name. Chat Completions is the default API.

Supports API keys, Microsoft Entra token providers, injected SDK clients, streaming,
tools, structured output, embeddings, and media models where available on your deployment.

## Learn more

- [Usage and migration guide](https://github.com/anvia-hq/anvia/blob/main/docs/packages/provider-azure.md)
- [Anvia overview](https://github.com/anvia-hq/anvia/blob/main/README.md)
