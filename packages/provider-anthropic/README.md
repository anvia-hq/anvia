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

const model = client.completionModel("claude-sonnet-4-20250514");

const agent = new Agent({
  id: "assistant",
  model: model,
  instructions: "Answer clearly and concisely.",
});

const result = await agent.generate({ prompt: "Summarize Anvia in one sentence." });
if (result.status === "completed") console.log(result.output);
```

## Anthropic-Compatible APIs

For APIs that expose an Anthropic-compatible surface, pass a custom `baseUrl`:

```ts
import { AnthropicClient } from "@anvia/anthropic";

const client = new AnthropicClient({
  apiKey,
  baseUrl,
});

const model = client.completionModel("provider/model-name");
```

## Vertex AI

Use Anthropic's official Vertex SDK through `AnthropicVertexClient`:

```ts
import { AnthropicVertexClient } from "@anvia/anthropic";

const client = new AnthropicVertexClient({
  projectId: "my-gcp-project",
  region: "global",
});

const model = client.completionModel("claude-sonnet-5");
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

## Exports

- `AnthropicClient`
- `AnthropicVertexClient`
- `AnthropicCompletionModel`
- `anthropic`

## Development

```sh
pnpm --filter @anvia/anthropic typecheck
pnpm --filter @anvia/anthropic test
pnpm --filter @anvia/anthropic build
```

Package-local `typecheck` and `build` scripts build `@anvia/core` first so core subpath types are available in a fresh worktree.
