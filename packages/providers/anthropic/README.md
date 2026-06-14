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
import { AgentBuilder } from "@anvia/core";
import { AnthropicClient } from "@anvia/anthropic";

const client = new AnthropicClient({
  apiKey,
});

const model = client.completionModel("claude-sonnet-4-20250514");

const agent = new AgentBuilder("assistant", model)
  .instructions("Answer clearly and concisely.")
  .build();

const response = await agent.prompt("Summarize Anvia in one sentence.").send();

console.log(response.output);
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

## Exports

- `AnthropicClient`
- `AnthropicCompletionModel`
- `anthropic`

## Development

```sh
pnpm --filter @anvia/anthropic typecheck
pnpm --filter @anvia/anthropic test
pnpm --filter @anvia/anthropic build
```

Package-local `typecheck` and `build` scripts build `@anvia/core` first so core subpath types are available in a fresh worktree.
