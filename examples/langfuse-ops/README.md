# langfuse-ops

Quickstart package for exercising the main `@anvia/langfuse` happy path against
a real Langfuse project and a real Anvia agent.

This phase intentionally ships only the first-success flow. The broader tracing,
scoring, eval, experiment, prompt, and redaction catalog is planned for later
phases.

## Prerequisites

Create a `.env` at the repo root. The package-local `.env.example` is a
template only; scripts load `../../.env`.

```sh
LANGFUSE_PUBLIC_KEY=pk-...
LANGFUSE_SECRET_KEY=sk-...
LANGFUSE_BASE_URL=https://cloud.langfuse.com
LANGFUSE_TRACING_ENVIRONMENT=development
LANGFUSE_RELEASE=0.0.0
LANGFUSE_SERVICE_NAME=langfuse-ops

OPENAI_API_KEY=sk-...
OPENAI_BASEURL=
ANVIA_MODEL=gpt-5
```

## Run

```sh
pnpm --filter langfuse-ops start
```

The quickstart:

1. Builds a support agent with one tool.
2. Sends one traced agent run to Langfuse.
3. Adds `quality` and `verdict` scores.
4. Runs one eval reporter case against the same trace.
5. Creates one uniquely named quickstart dataset.
6. Calls `shutdown()` before exit.

The script prints the agent output, trace ID, score names, dataset name, and a
Langfuse trace URL/base URL target to inspect.

## Checks

```sh
pnpm --filter langfuse-ops typecheck
```
