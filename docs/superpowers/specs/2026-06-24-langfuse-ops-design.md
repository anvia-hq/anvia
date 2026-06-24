# langfuse-ops Design

Date: 2026-06-24
Status: Approved (brainstorming complete, pending writing-plans)
Owner: anvia-hq

## Goal

Create a new example package at `examples/langfuse-ops/` that exercises
every public feature of `@anvia/langfuse` against a real Langfuse project
and a real Anvia agent. The package exists for three audiences:

1. **New users** evaluating the adapter: a runnable catalog that proves
   every advertised feature works end to end
2. **Contributors** changing the adapter: a regression net that hits the
   real wire format on every change
3. **Documentation**: a living reference that mirrors the README and stays
   accurate because every claim is a runnable command

## Non-Goals

- A test harness with mocked Langfuse. The user chose "Real Langfuse API".
  Mocking is out of scope for this package.
- A CLI. The user chose cookbook-style per-feature scripts.
- Re-implementing the adapter. This package only consumes
  `@anvia/langfuse`; it never re-exports, extends, or re-implements it.
- Production use. Demos are illustrative. Long-running services, real auth,
  and persistent storage are out of scope.

## Conventions

The package follows the cookbook's discipline exactly so anyone who has run
`examples/cookbook/10_integrations/03-langfuse-tracing.ts` already knows
how to run a demo here:

- One feature per script
- Per-feature npm script in `package.json`
- `tsx -r dotenv/config <path> dotenv_config_path=../../.env` invocation
- `.env` at the repo root (one file, shared with cookbook + cli-agent)
- `tsconfig.json` extends the repo base config and path-maps `@anvia/*`
  straight to source

## Package layout

```
examples/langfuse-ops/
├── package.json
├── tsconfig.json
├── README.md
├── .env.example
├── .gitignore
└── src/
    ├── _support/
    │   ├── env.ts
    │   ├── model.ts
    │   ├── agent.ts
    │   └── tracing.ts
    ├── 00-quickstart.ts
    ├── 01-tracing/
    │   ├── 01-basic-trace.ts
    │   ├── 02-streaming-deltas.ts
    │   ├── 03-trace-handle.ts
    │   ├── 04-tool-observations.ts
    │   ├── 05-service-name.ts
    │   └── 06-multi-turn.ts
    ├── 02-scoring/
    │   ├── 01-direct-score-types.ts
    │   ├── 02-score-overrides.ts
    │   ├── 03-batched-queue.ts
    │   ├── 04-score-error-handling.ts
    │   └── 05-queue-depth.ts
    ├── 03-eval-reporter/
    │   ├── 01-basic-eval.ts
    │   ├── 02-publish-invalid.ts
    │   ├── 03-missing-trace.ts
    │   ├── 04-truncate-input.ts
    │   ├── 05-include-messages.ts
    │   ├── 06-categorical-metric.ts
    │   └── 07-trace-resolution.ts
    ├── 04-experiments/
    │   ├── 01-create-dataset.ts
    │   ├── 02-upsert-items.ts
    │   ├── 03-get-dataset.ts
    │   ├── 04-run-experiment.ts
    │   ├── 05-run-experiment-errors.ts
    │   └── 06-eval-as-experiment.ts
    ├── 05-prompts/
    │   ├── 01-fetch-text.ts
    │   ├── 02-fetch-chat.ts
    │   ├── 03-version-and-label.ts
    │   ├── 04-cache-and-refresh.ts
    │   └── 05-link-to-trace.ts
    └── 06-redaction/
        ├── 01-default-patterns.ts
        ├── 02-redact-object.ts
        ├── 03-redact-messages.ts
        ├── 04-custom-pattern.ts
        ├── 05-custom-replacement.ts
        ├── 06-deep-mode.ts
        └── 07-tracing-integration.ts
```

Total: 1 quickstart + 6 + 5 + 7 + 6 + 5 + 7 = 37 scripts.

## Script catalog

### `src/00-quickstart.ts`

One-shot end-to-end: build a real Anvia agent with one tool, run it under
`langfuse.create()`, attach NUMERIC and CATEGORICAL scores, run a one-case
eval suite with `createLangfuseEvalReporter`, flush, then log the trace ID,
score names, and dataset name.

### `src/01-tracing/` (6 scripts)

| File                       | Feature covered                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------ |
| `01-basic-trace.ts`        | `langfuse.create({ publicKey, secretKey, baseUrl, environment, release })`, `.observe(tracing)`, `withTrace({ name, userId, sessionId, metadata, tags })`, `flush()`, `shutdown()` |
| `02-streaming-deltas.ts`   | Stream agent output; exercise `text_delta`, `reasoning_delta`, `tool_call` updates on the generation observation |
| `03-trace-handle.ts`       | `tracing.getCurrentTrace()` -> `addEvent(name, attrs)`, `addAttributes(attrs)`, plus the `run.event?.()` hook |
| `04-tool-observations.ts`  | Agent with a tool; show tool span carries `toolDefinition`, `toolMetadata`, `structuredResult`   |
| `05-service-name.ts`       | `serviceName` flowing into OTel `service.name` resource and the root run observation              |
| `06-multi-turn.ts`         | Multi-turn agent run; show trace across turns (cache hits, multiple generations)                  |

### `src/02-scoring/` (5 scripts)

| File                              | Feature covered                                                                          |
| --------------------------------- | ---------------------------------------------------------------------------------------- |
| `01-direct-score-types.ts`        | `tracing.score()` with `NUMERIC`, `CATEGORICAL`, `BOOLEAN` data types                    |
| `02-score-overrides.ts`           | `configId` (and `scoreConfigId` alias), `environment` override, `timestamp` Date + ISO, `comment`, `metadata` |
| `03-batched-queue.ts`             | `scoreBatchSize`, `scoreFlushIntervalMs`, `scoreMaxRetries`, `flushScores()`, debounce + size-trigger |
| `04-score-error-handling.ts`      | Catch `LangfuseScoreError`, inspect `.scores` and `.cause`                               |
| `05-queue-depth.ts`               | `scoreQueueDepth()` polling around `score()` calls to show queue draining                |

### `src/03-eval-reporter/` (7 scripts)

| File                                | Feature covered                                                                          |
| ----------------------------------- | ---------------------------------------------------------------------------------------- |
| `01-basic-eval.ts`                  | `runEvalSuite` with `contains` / `equals` + `createLangfuseEvalReporter` writing to a real trace |
| `02-publish-invalid.ts`             | `publishInvalid: true` to surface invalid outcomes as zero scores, and the default (drop) |
| `03-missing-trace.ts`               | All three `onMissingTrace` modes: `ignore`, `warn`, `throw`                              |
| `04-truncate-input.ts`              | `truncateInputAt` with a tiny cap to show the `<truncated>` marker on `caseInputSummary` / `caseExpectedSummary` |
| `05-include-messages.ts`            | `includeMessages: true` vs `false` to show the `output.messages` metadata key            |
| `06-categorical-metric.ts`          | `defineMetric({ dataType: "CATEGORICAL", configId, metadata })` round-trip + `BOOLEAN` variant |
| `07-trace-resolution.ts`            | All three resolution tiers: `output.trace`, `case.input.trace`, `case.metadata.traceId`/`observationId` |

### `src/04-experiments/` (6 scripts)

| File                                 | Feature covered                                                                         |
| ------------------------------------ | --------------------------------------------------------------------------------------- |
| `01-create-dataset.ts`               | `client.createDataset({ name, description, metadata })` (PUT)                           |
| `02-upsert-items.ts`                 | `client.upsertItems(name, items[])` to push new items                                   |
| `03-get-dataset.ts`                  | `client.getDataset(name)` with `pageSize` and pagination                                |
| `04-run-experiment.ts`               | `client.runExperiment({ datasetName, runName, run })` happy path                       |
| `05-run-experiment-errors.ts`        | Per-item failures: catch, see them in `result.errors`, only successful items reach the batched POST |
| `06-eval-as-experiment.ts`           | `runEvalAsExperiment` (suite + dataset run + per-case scores)                           |

### `src/05-prompts/` (5 scripts)

| File                          | Feature covered                                                                          |
| ----------------------------- | ---------------------------------------------------------------------------------------- |
| `01-fetch-text.ts`            | `getPromptText(name)`; throws on chat prompts                                            |
| `02-fetch-chat.ts`            | `getPromptChat(name)`; throws on text prompts                                            |
| `03-version-and-label.ts`     | `getPrompt(name, { version })` and `getPrompt(name, { label })`                          |
| `04-cache-and-refresh.ts`     | `cacheTtlMs`, the `refresh: true` flag, `client.refresh()`                               |
| `05-link-to-trace.ts`         | `promptRef` on `AgentRunStartArgs` plus the legacy `promptName` / `promptVersion` on `trace.metadata` |

### `src/06-redaction/` (7 scripts)

| File                              | Feature covered                                                                          |
| --------------------------------- | ---------------------------------------------------------------------------------------- |
| `01-default-patterns.ts`          | `DEFAULT_PATTERNS` (email, creditCard w/ Luhn, ipv4, phone, jwt, apiKey), `redactString` |
| `02-redact-object.ts`             | `redactObject` on a nested object with a mix of strings, numbers, and arrays             |
| `03-redact-messages.ts`           | `redactMessages` on a chat history with `text` parts                                     |
| `04-custom-pattern.ts`            | Add a custom regex (e.g. SSN) via `patterns` option                                      |
| `05-custom-replacement.ts`        | Custom `replacement` string instead of `[REDACTED]`                                      |
| `06-deep-mode.ts`                 | Tracing `redactOutputs: "deep"` recursing into nested tool results                      |
| `07-tracing-integration.ts`       | `redactInputs`, `redactOutputs`, and the full `redaction` block on `langfuse.create`     |

## Support module API (`src/_support/`)

Four files. Each is under 60 lines and only re-exports existing types.

### `env.ts`

- `loadEnv()` - no-op marker; the actual dotenv loading happens via
  `tsx -r dotenv/config ... dotenv_config_path=../../.env` in the script
  line. Exists for symmetry and to make every script read consistently
- `requireEnv(name: string): string` - throws with a clear "did you set this
  in `.env`?" message if missing or empty
- `optionalEnv(name: string): string | undefined` - empty string maps to
  `undefined`
- `getLangfuseEnv()` - returns `{ publicKey, secretKey, baseUrl, environment,
  release, serviceName }` resolved from `LANGFUSE_*` env vars, with
  `requireEnv` on the public/secret key pair

### `model.ts`

- `buildOpenAIClient()` - returns `new OpenAIClient({ apiKey: requireEnv("OPENAI_API_KEY"), baseUrl: process.env.OPENAI_BASEURL })`
- `defaultModel()` - returns `process.env.ANVIA_MODEL ?? "gpt-5"`
- `getStaticModel(textResponse)` - returns a fake `CompletionModel` that
  always produces the supplied text. Used by `04-experiments/05-run-experiment-errors.ts`,
  `03-eval-reporter/01-basic-eval.ts`, and any other demo where a real LLM
  call would add noise and cost

### `agent.ts`

- `buildSupportAgent(model, { tools?: Tool[] })` - returns a
  `new AgentBuilder("support-agent", model).instructions(...).observe(tracing).tools(tools ?? []).defaultMaxTurns(2).build()`
  with the cookbook's pre-instructions: `"Use tools when useful. Answer
  with a short engineering-focused summary."`
- The tool, when supplied, is the same `get_ticket` from cookbook
  `10_integrations/03-langfuse-tracing.ts` so the tool-observations demo
  mirrors an existing real-world example

### `tracing.ts`

- `createTracing(opts?: { name?: string; redactInputs?: boolean;
  redactOutputs?: boolean | "deep"; redaction?: LangfuseRedactionOptions;
  scoreBatchSize?: number; scoreFlushIntervalMs?: number;
  scoreMaxRetries?: number })` - returns a `LangfuseTracing` wired with
  `LANGFUSE_*` env vars, `serviceName: opts.name ?? "langfuse-ops"`, and
  the optional overrides
- `withRun(agent, { name, userId?, sessionId?, metadata?, tags?, promptRef? })`
  - thin wrapper around `agent.prompt(...).withTrace(...)` so each tracing
  script doesn't repeat the same five lines

## package.json

Name: `langfuse-ops`, private, ESM. Per-feature scripts in the form
`pnpm --filter langfuse-ops <group>:<n>` plus per-group aliases
(`tracing`, `scoring`, `eval-reporter`, `experiments`, `prompts`,
`redaction`) that each point at the `:01` script of the group
(cookbook convention). The `start` alias points at
`src/00-quickstart.ts` (the all-in-one demo).

Dependencies: `@anvia/core`, `@anvia/langfuse`, `@anvia/openai`, `dotenv`,
`zod`.

Dev dependencies: `@types/node`, `tsx`, `typescript`.

`typecheck` script: `tsc --noEmit`.

No `build` script: the package is a runnable example, not a published
artifact.

## tsconfig.json

Extends `../../tsconfig.base.json`. `noEmit: true`. Path-maps every
`@anvia/*` import to the source under `../../packages/*` (matches the
cookbook's path block, including `@anvia/core/*` -> `../../packages/core/src/*/index.ts`).

## .env.example

```
LANGFUSE_PUBLIC_KEY=
LANGFUSE_SECRET_KEY=
LANGFUSE_BASE_URL=https://cloud.langfuse.com
LANGFUSE_TRACING_ENVIRONMENT=development
LANGFUSE_RELEASE=0.0.0
LANGFUSE_SERVICE_NAME=langfuse-ops

OPENAI_API_KEY=
OPENAI_BASEURL=
ANVIA_MODEL=gpt-5
```

The `.env` file itself lives at the repo root (`../../.env`) and is shared
with cookbook + cli-agent. We never check in secrets.

## .gitignore

```
.env
node_modules/
dist/
```

## README

Sections:

1. Title + one-line description
2. Prerequisites (Langfuse project + OpenAI key + `.env`)
3. Quickstart (`pnpm --filter langfuse-ops start`)
4. Feature catalog (table mapping `pnpm --filter langfuse-ops <group>:<n>`
   to what it shows)
5. What you'll see in Langfuse (sets the expectation that the user will find
   the artifacts in their project)
6. How each script is structured (load env -> create tracing -> run feature
   -> log artifact ID -> `shutdown()`)

## Verification

After the package is in place, run in this order:

1. **Typecheck**: `pnpm --filter langfuse-ops typecheck` (mirrors cookbook's
   `tsc --noEmit`)
2. **Quickstart smoke**: `pnpm --filter langfuse-ops start` against a real
   Langfuse project; confirm the trace ID, score names, and dataset name
   print
3. **Per-group sample**: one script from each group to confirm path
   mappings, env loading, and `tracing.shutdown()` cleanup all work:
   - `tracing:01`, `scoring:01`, `eval-reporter:01`, `experiments:01`,
     `prompts:01`, `redaction:01`
4. **Offline-safe redaction**: `redaction:01` through `redaction:06` must
   not call the Langfuse API; smoke-test them without Langfuse credentials.
   `redaction:07` does call the API.

No automated tests in the package. The cookbook doesn't ship any, and the
demos double as integration tests against the real API. The "did it work"
signal is the artifact ID printed at the end of each script.

## Risks and mitigations

- **Network dependency**: every demo (except 6 of 7 redaction demos) requires
  a real Langfuse project. Mitigation: the 6 redaction demos run offline
  and double as a smoke test when credentials are missing.
- **Cost**: demos that hit OpenAI cost tokens. Mitigation: short prompts, low
  `maxTurns`, and `getStaticModel()` for demos that don't need a real LLM
  call.
- **Drift from adapter**: when the adapter adds a new feature, this package
  must be updated. Mitigation: a future CI job could grep the adapter's
  exports and fail when a new export is not represented by a script in this
  catalog. Out of scope for this design.
- **Schema drift**: Langfuse can change API shapes. Mitigation: the demos
  hit real endpoints, so failures surface immediately during the
  quickstart smoke.
