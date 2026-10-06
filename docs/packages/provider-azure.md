# @anvia/azure

Azure OpenAI configuration for Anvia, sharing the request and response adapters from
`@anvia/openai`. Install with `pnpm add @anvia/azure @anvia/core`.

## Endpoint and authentication

```ts
import { AzureOpenAIClient } from "@anvia/azure";

const client = new AzureOpenAIClient({
  endpoint: "https://example.openai.azure.com",
  apiKey: process.env.AZURE_OPENAI_API_KEY!,
});
```

`endpoint` must be a resource origin; the client appends `/openai/v1/`. Both Azure
OpenAI resource domains and `services.ai.azure.com` resource domains can be used.
For a complete API URL or gateway, use `baseUrl` instead:

```ts
const client = new AzureOpenAIClient({
  baseUrl: "https://example.services.ai.azure.com/openai/v1/",
  apiKey: process.env.AZURE_OPENAI_API_KEY!,
});
```

The managed client uses the [Azure v1 API](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/api-version-lifecycle),
which does not require an `api-version` query parameter. Pass credentials and endpoint
explicitly; this adapter does not select them from environment variables for you.
Optional `headers` and `fetch` configure the managed SDK client. SDK retries are disabled
so Anvia owns retry policy.

For Microsoft Entra authentication, pass an asynchronous token provider instead of `apiKey`:

```ts
import { DefaultAzureCredential, getBearerTokenProvider } from "@azure/identity";

const client = new AzureOpenAIClient({
  endpoint: process.env.AZURE_OPENAI_ENDPOINT!,
  azureADTokenProvider: getBearerTokenProvider(
    new DefaultAzureCredential(),
    "https://cognitiveservices.azure.com/.default",
  ),
});
```

Install `@azure/identity` separately when using this example. The token provider is called
for each request and owns token caching and refresh.

For a [Foundry project endpoint](https://learn.microsoft.com/en-us/rest/api/microsoft-foundry/aiproject),
use its full URL and the project token scope:

```ts
const projectClient = new AzureOpenAIClient({
  baseUrl: "https://example.services.ai.azure.com/api/projects/demo/openai/v1/",
  azureADTokenProvider: getBearerTokenProvider(
    new DefaultAzureCredential(),
    "https://ai.azure.com/.default",
  ),
});
```

The adapter passes tokens through; select the scope required by the endpoint you call.

## Deployments and models

```ts
const chat = client.completionModel({ modelId: "my-chat-deployment" });
const responses = client.completionModel({ modelId: "my-chat-deployment", api: "responses" });
const embeddings = client.embeddingModel({ modelId: "my-embedding-deployment" });
const images = client.imageGenerationModel({ modelId: "my-image-deployment" });
const speech = client.speechGenerationModel({ modelId: "my-speech-deployment" });
const transcription = client.transcriptionModel({ modelId: "my-transcription-deployment" });
```

Use deployment names as `modelId`, not necessarily the underlying model name. Availability
of APIs, tools, media options, and model listing depends on your Azure endpoint and deployment.
`listModels()` calls the endpoint's model listing API; it does not enumerate Azure Resource
Manager deployments. Handles and listing errors identify the provider as `azure-openai`.

Known OpenAI model names retain their inferred reasoning controls and context limits.
For custom deployment names, specify these explicitly where needed:

```ts
const model = client.completionModel({
  modelId: "production-reasoning",
  api: "responses",
  contextLimits: { contextWindow: 128_000, maxOutputTokens: 16_000 },
  controls: {
    reasoningEffort: {
      type: "select",
      label: "Reasoning effort",
      options: ["low", "medium", "high"],
    },
  },
});
```

Match these values to the deployed model. For DALL-E deployments with a custom name,
pass `providerOptions: { response_format: "b64_json" }` to image generation; the shared
adapter returns image bytes and does not download URL responses.

## Existing SDK clients and versioned endpoints

For older Azure APIs that need `api-version`, inject the OpenAI SDK's Azure client:

```ts
import { AzureOpenAI } from "openai";

const client = new AzureOpenAIClient({
  client: new AzureOpenAI({
    baseURL: `${process.env.AZURE_OPENAI_ENDPOINT!}/openai`,
    apiKey: process.env.AZURE_OPENAI_API_KEY!,
    apiVersion: process.env.AZURE_OPENAI_API_VERSION!,
  }),
});
```

Install `openai` separately when importing the SDK directly. Choose an API version supported
by the operations you use. Injected clients own endpoint, authentication, headers, and transport;
combining `client` with managed configuration is rejected.

## Migration from @anvia/openai

Replace `OpenAIClient` with `AzureOpenAIClient` and import it from `@anvia/azure`.
Existing Azure `baseUrl` and `apiKey` values can be kept, along with the same model-handle
calls. Use Azure credential variable names to keep the two providers separate.

Existing `@anvia/openai` custom endpoints remain supported, but Azure Responses event
normalization belongs to `AzureOpenAIClient`. Its Responses model resolves omitted terminal
function names from earlier function-call items, keeping state local to each stream and
matching parallel tool calls by item ID. Missing identities and conflicting names are rejected.
Azure Responses requests also tag conversation messages with `type: "message"` for Foundry
project compatibility, preserving function-call and tool-result item types.

OpenAI's parser accepts unnamed argument events without synthesizing a name; it validates
the name on completed function calls. Azure's model extends the shared Responses adapter
through `@anvia/openai/adapters`, so common request mapping, tool-result serialization,
argument validation, and stream completion checks are reused without Azure-specific logic
in the OpenAI parser.

## Comparison with @ai-sdk/azure

The [AI SDK Azure provider](https://github.com/vercel/ai/blob/main/packages/azure/src/azure-openai-provider.ts)
also reuses OpenAI model implementations. Azure owns authentication, deployment routing,
API version configuration, provider identity, and endpoint-specific options. Its Responses
configuration includes explicit message-item types for Foundry project endpoints and
Azure file-ID prefixes; it exposes a separate set of hosted-tool helpers.

Anvia follows the same separation of ownership, with Azure stream normalization in this
package. This package does not claim full AI SDK feature parity: it defaults to Chat
Completions, uses an injected Azure SDK for versioned endpoints, and does not add AI SDK's
file-ID prefix inference, hosted-tool helpers, or Azure Speech/MAI adapters.

Missing `name` on an arguments-done event is not exclusive to Azure: AI SDK's
[shared Responses schema](https://github.com/vercel/ai/blob/main/packages/openai/src/responses/openai-responses-api.ts)
also accepts it for OpenAI. Keeping native support for that event avoids making OpenAI
streams depend on Azure's normalization policy.

## Validation

```sh
pnpm --filter @anvia/azure test
pnpm --filter @anvia/azure typecheck
pnpm --filter @anvia/azure build
```

Ordinary tests use mocked SDK calls or fetch. The live Responses tool-call test runs only
when `ANVIA_AZURE_OPENAI_TESTS=1`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_BASE_URL`, and
`AZURE_OPENAI_DEPLOYMENT` are set. It makes a real provider request.

To use the repository's root `.env`, fill `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_BASE_URL`
(the full API URL), and `AZURE_OPENAI_DEPLOYMENT`, then run from the repository root:

```sh
pnpm --filter @anvia/azure test:live
```

This command loads the root `.env` and enables the live-test flag for its own process.
Missing required values fail with their variable names rather than silently skipping the test.
The normal `test` command does not load `.env`. The root `.env` is ignored by Git;
`.env.example` contains only placeholders.

## Exports

- `AzureOpenAIClient` and `AzureOpenAIClientOptions`
- `AzureOpenAICompletionModel` and `AzureOpenAICompletionModelOptions`
- `AzureOpenAIEmbeddingModelHandle` and `AzureOpenAIEmbeddingModelOptions`
- Image generation, speech generation, and transcription handle and option types with the
  `AzureOpenAI` prefix
