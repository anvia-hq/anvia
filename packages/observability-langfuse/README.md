# @anvia/langfuse

Langfuse tracing adapter for Anvia.

Use this package to attach Langfuse tracing to Anvia agents and to publish evaluation scores from Anvia eval reporters.

## Installation

```sh
pnpm add @anvia/langfuse @anvia/core
```

In this monorepo, the package is available through the workspace:

```sh
pnpm --filter @anvia/langfuse build
```

## Usage

```ts
import { AgentBuilder } from "@anvia/core";
import { OpenAIClient } from "@anvia/openai";
import { langfuse } from "@anvia/langfuse";

const tracing = langfuse.create({
  publicKey,
  secretKey,
  baseUrl,
  environment,
  release,
});

const client = new OpenAIClient({
  apiKey,
});

const agent = new AgentBuilder("support", client.completionModel())
  .instructions("Answer support questions clearly.")
  .observe(tracing)
  .build();

const response = await agent.prompt("How do I reset my password?").send();

console.log(response.output);

await tracing.flush();
```

Use `flush()` after short-lived jobs. Use `shutdown()` when the process is exiting.

## Configuration

`langfuse.create()` accepts the following options. Any option that is
left undefined falls back to the matching environment variable, and
explicit options always win.

| Option        | Environment variable          | Notes                                                      |
| ------------- | ----------------------------- | ---------------------------------------------------------- |
| `publicKey`   | `LANGFUSE_PUBLIC_KEY`         | Required for score publishing.                             |
| `secretKey`   | `LANGFUSE_SECRET_KEY`         | Required for score publishing.                             |
| `baseUrl`     | `LANGFUSE_BASE_URL`           | Defaults to `https://cloud.langfuse.com`.                  |
| `environment` | `LANGFUSE_TRACING_ENVIRONMENT`| Tag attached to every trace.                               |
| `release`     | `LANGFUSE_RELEASE`            | Tag attached to every trace.                               |
| `serviceName` | `LANGFUSE_SERVICE_NAME`       | Recorded on the root observation and as the OTel `service.name` resource attribute. |

```ts
const tracing = langfuse.create({
  // All fields are optional and fall back to env vars.
  serviceName: "support-agent",
});
```

## Observation metadata

The adapter records extra data on Langfuse observations so the UI
shows everything the agent runtime emits:

- **Generation observations** carry `providerRequest` and `modelInfo`
  (with `provider`, `defaultModel`, and `capabilities`) on start, and
  `firstDeltaMs` on end. `usageDetails` always includes
  `cachedInputTokens` and `cacheCreationInputTokens`.
- **Tool observations** carry `toolDefinition` and `toolMetadata` on
  start, and `structuredResult` on end.
- **Root run observation** carries `serviceName` and the configured
  `metadata` from `AgentRunStartArgs`.

User-supplied `trace.metadata` always wins over the built-in fields
above (the spread order preserves it).

## Eval Scores

```ts
import { createLangfuseEvalReporter } from "@anvia/langfuse";

const reporter = createLangfuseEvalReporter(tracing);
```

The reporter reads trace information from eval output when available, then publishes metric scores to Langfuse.

## Exports

- `langfuse`
- `createLangfuseEvalReporter`
- `LangfuseTracing`
- `LangfuseTracingOptions`
- `LangfuseScoreArgs`
- `LangfuseEvalReporterOptions`

## Development

```sh
pnpm --filter @anvia/langfuse typecheck
pnpm --filter @anvia/langfuse test
pnpm --filter @anvia/langfuse build
```
