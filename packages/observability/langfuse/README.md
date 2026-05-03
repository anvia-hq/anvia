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
