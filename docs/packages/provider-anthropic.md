# @anvia/anthropic

Anthropic provider adapter for Anvia.

Use this package when you want Anvia agents, extractors, or pipelines to run on Claude models through Anthropic's SDK, or through an Anthropic-compatible API endpoint.

## Installation

```sh
pnpm add @anvia/anthropic @anvia/core
```

In this monorepo, the package is available through the workspace:

```sh
pnpm --filter @anvia/anthropic build
```

## Usage

```ts
import { Agent } from "@anvia/core";
import { AnthropicClient } from "@anvia/anthropic";

const client = new AnthropicClient({
  apiKey,
});

const model = client.completionModel({ modelId: "claude-opus-5" });

const agent = new Agent({
  id: "assistant",
  model: model,
  instructions: "Answer clearly and concisely.",
});

const result = await agent.generate({ prompt: "Summarize Anvia in one sentence." });
if (result.type === "response") console.log(result.output);
```

## Anthropic-Compatible APIs

For APIs that expose an Anthropic-compatible surface, pass a custom `baseUrl`:

```ts
import { AnthropicClient } from "@anvia/anthropic";

const client = new AnthropicClient({
  apiKey,
  baseUrl,
});

const model = client.completionModel({ modelId: "provider/model-name" });
```

## Vertex AI

Use Anthropic's official Vertex SDK through `AnthropicVertexClient`:

```ts
import { AnthropicVertexClient } from "@anvia/anthropic";

const client = new AnthropicVertexClient({
  projectId: "my-gcp-project",
  region: "global",
});

const model = client.completionModel({ modelId: "claude-sonnet-5" });
```

The client follows the standard Google authentication flow. It reads
`ANTHROPIC_VERTEX_PROJECT_ID` and `CLOUD_ML_REGION` when project and region are omitted, and supports
Application Default Credentials such as `GOOGLE_APPLICATION_CREDENTIALS`:

```sh
export ANTHROPIC_VERTEX_PROJECT_ID="my-gcp-project"
export CLOUD_ML_REGION="global"
export GOOGLE_APPLICATION_CREDENTIALS="/absolute/path/service-account.json"
```

For custom authentication, pass the official SDK's `googleAuth`, `authClient`, or `accessToken`
options:

```sh
pnpm add google-auth-library
```

```ts
import { GoogleAuth } from "google-auth-library";

const client = new AnthropicVertexClient({
  projectId: "my-gcp-project",
  region: "global",
  googleAuth: new GoogleAuth({
    credentials: serviceAccountJson,
    scopes: "https://www.googleapis.com/auth/cloud-platform",
  }),
});
```

You can also pass a preconfigured `authClient`, including impersonated credentials. Validate
externally supplied credential configurations before using them, and never commit credential JSON
or service-account keys.

Vertex AI does not expose Anthropic's Models API, so `AnthropicVertexClient` intentionally does not
provide `listModels()`.

## Prompt Caching

Anthropic can reuse a request prefix it already processed and bill those tokens as cache reads.
Enable it per model and the adapter places the breakpoints:

```ts
const model = client.completionModel({ modelId: "claude-sonnet-5", promptCache: true });
```

With `promptCache: true`, an `AnthropicCompletionModel` marks three `cache_control: { type:
"ephemeral" }` breakpoints: the last tool definition, the system prompt, and the last block of the
conversation that accepts a breakpoint. Each turn then reads the prefix it sent before and writes
only what follows it. Thinking blocks cannot carry a breakpoint, so a conversation that ends in
private reasoning places the breakpoint on the closest block before it.

The default cache lives five minutes. Use the extended cache for a prefix that should survive
longer:

```ts
const model = client.completionModel({ modelId: "claude-sonnet-5", promptCache: { ttl: "1h" } });
```

Anthropic accepts at most four breakpoints per request. Breakpoints that already exist in the
request count towards that limit and are left where they are. `AnthropicClient` and
`AnthropicVertexClient` accept the same option, and an unsupported `ttl` fails when the model is
created rather than on the first call.

Anthropic ignores a breakpoint whose prefix is shorter than the model minimum, for example 1024
tokens on Claude Sonnet and Opus and 4096 on Claude Haiku 4.5. A request that reads from cache
reports the tokens in `usage.cachedInputTokens`, and a request that writes to the cache reports
them in `usage.cacheCreationInputTokens`.

For a hand-built Messages request, apply the same breakpoints yourself:

```ts
import { withAnthropicPromptCache } from "@anvia/anthropic";

const params = withAnthropicPromptCache(
  { model: "claude-sonnet-5", max_tokens: 1024, system: instructions, messages, tools },
  { ttl: "1h" },
);
```

## Exports

- `AnthropicClient`
- `AnthropicVertexClient`
- structural Anthropic and Vertex completion handle types
- `AnthropicCompletionModelId`
- `AnthropicPromptCacheOptions`, `AnthropicPromptCacheSettings`, `AnthropicPromptCacheTtl`
- `withAnthropicPromptCache`, `anthropicPromptCacheOptions`
- `anthropic`
