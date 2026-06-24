# langfuse-ops Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `examples/langfuse-ops/` package - a runnable catalog of 37 demos that exercise every public feature of `@anvia/langfuse` against a real Langfuse project and a real Anvia agent.

**Architecture:** Cookbook-style example package. One script per feature, grouped by feature area into numbered subdirectories under `src/`. A thin `_support/` module handles env loading, model construction, and the shared support agent. Per-feature npm scripts. Path-mapped tsconfig that resolves `@anvia/*` to source.

**Tech Stack:** TypeScript (ESM), `tsx` for direct execution, `dotenv` for env loading, `@anvia/core`, `@anvia/openai`, `@anvia/langfuse`, `zod`.

**Spec:** `docs/superpowers/specs/2026-06-24-langfuse-ops-design.md`

---

## File Structure

Files this plan creates (41 files total):

| Path | Purpose |
| --- | --- |
| `examples/langfuse-ops/package.json` | npm scripts, deps, workspace links |
| `examples/langfuse-ops/tsconfig.json` | extends repo base + path-maps `@anvia/*` to source |
| `examples/langfuse-ops/.env.example` | documents required env vars |
| `examples/langfuse-ops/.gitignore` | ignores `.env`, `node_modules/`, `dist/` |
| `examples/langfuse-ops/README.md` | feature catalog, quickstart, what to look for in Langfuse |
| `examples/langfuse-ops/src/_support/env.ts` | `loadEnv`, `requireEnv`, `optionalEnv`, `getLangfuseEnv` |
| `examples/langfuse-ops/src/_support/model.ts` | `buildOpenAIClient`, `defaultModel`, `getStaticModel` |
| `examples/langfuse-ops/src/_support/agent.ts` | `buildSupportAgent` + the `get_ticket` tool |
| `examples/langfuse-ops/src/_support/tracing.ts` | `createTracing`, `withRun` |
| `examples/langfuse-ops/src/00-quickstart.ts` | one-shot end-to-end demo |
| `examples/langfuse-ops/src/01-tracing/01-basic-trace.ts` | `langfuse.create`, `.observe`, `withTrace`, `flush`, `shutdown` |
| `examples/langfuse-ops/src/01-tracing/02-streaming-deltas.ts` | stream agent + text/reasoning/tool deltas |
| `examples/langfuse-ops/src/01-tracing/03-trace-handle.ts` | `getCurrentTrace`, `addEvent`, `addAttributes`, `run.event?` |
| `examples/langfuse-ops/src/01-tracing/04-tool-observations.ts` | tool span with `toolDefinition`, `toolMetadata`, `structuredResult` |
| `examples/langfuse-ops/src/01-tracing/05-service-name.ts` | `serviceName` on OTel resource + root observation |
| `examples/langfuse-ops/src/01-tracing/06-multi-turn.ts` | multi-turn agent trace |
| `examples/langfuse-ops/src/02-scoring/01-direct-score-types.ts` | `NUMERIC`, `CATEGORICAL`, `BOOLEAN` |
| `examples/langfuse-ops/src/02-scoring/02-score-overrides.ts` | `configId`, `environment`, `timestamp`, `comment`, `metadata` |
| `examples/langfuse-ops/src/02-scoring/03-batched-queue.ts` | `scoreBatchSize`, `flushScores`, retries, debounce |
| `examples/langfuse-ops/src/02-scoring/04-score-error-handling.ts` | catch `LangfuseScoreError` |
| `examples/langfuse-ops/src/02-scoring/05-queue-depth.ts` | `scoreQueueDepth` monitoring |
| `examples/langfuse-ops/src/03-eval-reporter/01-basic-eval.ts` | `runEvalSuite` + reporter |
| `examples/langfuse-ops/src/03-eval-reporter/02-publish-invalid.ts` | `publishInvalid` toggle |
| `examples/langfuse-ops/src/03-eval-reporter/03-missing-trace.ts` | `onMissingTrace` modes |
| `examples/langfuse-ops/src/03-eval-reporter/04-truncate-input.ts` | `truncateInputAt` + `<truncated>` marker |
| `examples/langfuse-ops/src/03-eval-reporter/05-include-messages.ts` | `includeMessages` toggle |
| `examples/langfuse-ops/src/03-eval-reporter/06-categorical-metric.ts` | `defineMetric` CATEGORICAL + BOOLEAN |
| `examples/langfuse-ops/src/03-eval-reporter/07-trace-resolution.ts` | all 3 trace resolution tiers |
| `examples/langfuse-ops/src/04-experiments/01-create-dataset.ts` | `createDataset` |
| `examples/langfuse-ops/src/04-experiments/02-upsert-items.ts` | `upsertItems` |
| `examples/langfuse-ops/src/04-experiments/03-get-dataset.ts` | `getDataset` + pagination |
| `examples/langfuse-ops/src/04-experiments/04-run-experiment.ts` | `runExperiment` happy path |
| `examples/langfuse-ops/src/04-experiments/05-run-experiment-errors.ts` | per-item errors |
| `examples/langfuse-ops/src/04-experiments/06-eval-as-experiment.ts` | `runEvalAsExperiment` |
| `examples/langfuse-ops/src/05-prompts/01-fetch-text.ts` | `getPromptText` |
| `examples/langfuse-ops/src/05-prompts/02-fetch-chat.ts` | `getPromptChat` |
| `examples/langfuse-ops/src/05-prompts/03-version-and-label.ts` | `getPrompt` with version/label |
| `examples/langfuse-ops/src/05-prompts/04-cache-and-refresh.ts` | `cacheTtlMs`, `refresh: true`, `client.refresh()` |
| `examples/langfuse-ops/src/05-prompts/05-link-to-trace.ts` | `promptRef` on `AgentRunStartArgs` + metadata keys |
| `examples/langfuse-ops/src/06-redaction/01-default-patterns.ts` | `DEFAULT_PATTERNS` + `redactString` |
| `examples/langfuse-ops/src/06-redaction/02-redact-object.ts` | `redactObject` |
| `examples/langfuse-ops/src/06-redaction/03-redact-messages.ts` | `redactMessages` |
| `examples/langfuse-ops/src/06-redaction/04-custom-pattern.ts` | custom regex (SSN) |
| `examples/langfuse-ops/src/06-redaction/05-custom-replacement.ts` | custom replacement string |
| `examples/langfuse-ops/src/06-redaction/06-deep-mode.ts` | `redactOutputs: "deep"` recursing |
| `examples/langfuse-ops/src/06-redaction/07-tracing-integration.ts` | `redactInputs` + `redactOutputs` on `langfuse.create` |

---

## Task 1: Scaffold package files

**Files:**
- Create: `examples/langfuse-ops/package.json`
- Create: `examples/langfuse-ops/tsconfig.json`
- Create: `examples/langfuse-ops/.env.example`
- Create: `examples/langfuse-ops/.gitignore`

- [ ] **Step 1: Create `examples/langfuse-ops/package.json`**

```json
{
  "name": "langfuse-ops",
  "version": "0.1.0",
  "private": true,
  "license": "MIT",
  "type": "module",
  "scripts": {
    "start": "tsx -r dotenv/config src/00-quickstart.ts dotenv_config_path=../../.env",

    "tracing":        "tsx -r dotenv/config src/01-tracing/01-basic-trace.ts dotenv_config_path=../../.env",
    "tracing:01":     "tsx -r dotenv/config src/01-tracing/01-basic-trace.ts dotenv_config_path=../../.env",
    "tracing:02":     "tsx -r dotenv/config src/01-tracing/02-streaming-deltas.ts dotenv_config_path=../../.env",
    "tracing:03":     "tsx -r dotenv/config src/01-tracing/03-trace-handle.ts dotenv_config_path=../../.env",
    "tracing:04":     "tsx -r dotenv/config src/01-tracing/04-tool-observations.ts dotenv_config_path=../../.env",
    "tracing:05":     "tsx -r dotenv/config src/01-tracing/05-service-name.ts dotenv_config_path=../../.env",
    "tracing:06":     "tsx -r dotenv/config src/01-tracing/06-multi-turn.ts dotenv_config_path=../../.env",

    "scoring":        "tsx -r dotenv/config src/02-scoring/01-direct-score-types.ts dotenv_config_path=../../.env",
    "scoring:01":     "tsx -r dotenv/config src/02-scoring/01-direct-score-types.ts dotenv_config_path=../../.env",
    "scoring:02":     "tsx -r dotenv/config src/02-scoring/02-score-overrides.ts dotenv_config_path=../../.env",
    "scoring:03":     "tsx -r dotenv/config src/02-scoring/03-batched-queue.ts dotenv_config_path=../../.env",
    "scoring:04":     "tsx -r dotenv/config src/02-scoring/04-score-error-handling.ts dotenv_config_path=../../.env",
    "scoring:05":     "tsx -r dotenv/config src/02-scoring/05-queue-depth.ts dotenv_config_path=../../.env",

    "eval-reporter":  "tsx -r dotenv/config src/03-eval-reporter/01-basic-eval.ts dotenv_config_path=../../.env",
    "eval-reporter:01": "tsx -r dotenv/config src/03-eval-reporter/01-basic-eval.ts dotenv_config_path=../../.env",
    "eval-reporter:02": "tsx -r dotenv/config src/03-eval-reporter/02-publish-invalid.ts dotenv_config_path=../../.env",
    "eval-reporter:03": "tsx -r dotenv/config src/03-eval-reporter/03-missing-trace.ts dotenv_config_path=../../.env",
    "eval-reporter:04": "tsx -r dotenv/config src/03-eval-reporter/04-truncate-input.ts dotenv_config_path=../../.env",
    "eval-reporter:05": "tsx -r dotenv/config src/03-eval-reporter/05-include-messages.ts dotenv_config_path=../../.env",
    "eval-reporter:06": "tsx -r dotenv/config src/03-eval-reporter/06-categorical-metric.ts dotenv_config_path=../../.env",
    "eval-reporter:07": "tsx -r dotenv/config src/03-eval-reporter/07-trace-resolution.ts dotenv_config_path=../../.env",

    "experiments":    "tsx -r dotenv/config src/04-experiments/01-create-dataset.ts dotenv_config_path=../../.env",
    "experiments:01": "tsx -r dotenv/config src/04-experiments/01-create-dataset.ts dotenv_config_path=../../.env",
    "experiments:02": "tsx -r dotenv/config src/04-experiments/02-upsert-items.ts dotenv_config_path=../../.env",
    "experiments:03": "tsx -r dotenv/config src/04-experiments/03-get-dataset.ts dotenv_config_path=../../.env",
    "experiments:04": "tsx -r dotenv/config src/04-experiments/04-run-experiment.ts dotenv_config_path=../../.env",
    "experiments:05": "tsx -r dotenv/config src/04-experiments/05-run-experiment-errors.ts dotenv_config_path=../../.env",
    "experiments:06": "tsx -r dotenv/config src/04-experiments/06-eval-as-experiment.ts dotenv_config_path=../../.env",

    "prompts":        "tsx -r dotenv/config src/05-prompts/01-fetch-text.ts dotenv_config_path=../../.env",
    "prompts:01":     "tsx -r dotenv/config src/05-prompts/01-fetch-text.ts dotenv_config_path=../../.env",
    "prompts:02":     "tsx -r dotenv/config src/05-prompts/02-fetch-chat.ts dotenv_config_path=../../.env",
    "prompts:03":     "tsx -r dotenv/config src/05-prompts/03-version-and-label.ts dotenv_config_path=../../.env",
    "prompts:04":     "tsx -r dotenv/config src/05-prompts/04-cache-and-refresh.ts dotenv_config_path=../../.env",
    "prompts:05":     "tsx -r dotenv/config src/05-prompts/05-link-to-trace.ts dotenv_config_path=../../.env",

    "redaction":      "tsx -r dotenv/config src/06-redaction/01-default-patterns.ts dotenv_config_path=../../.env",
    "redaction:01":   "tsx -r dotenv/config src/06-redaction/01-default-patterns.ts dotenv_config_path=../../.env",
    "redaction:02":   "tsx -r dotenv/config src/06-redaction/02-redact-object.ts dotenv_config_path=../../.env",
    "redaction:03":   "tsx -r dotenv/config src/06-redaction/03-redact-messages.ts dotenv_config_path=../../.env",
    "redaction:04":   "tsx -r dotenv/config src/06-redaction/04-custom-pattern.ts dotenv_config_path=../../.env",
    "redaction:05":   "tsx -r dotenv/config src/06-redaction/05-custom-replacement.ts dotenv_config_path=../../.env",
    "redaction:06":   "tsx -r dotenv/config src/06-redaction/06-deep-mode.ts dotenv_config_path=../../.env",
    "redaction:07":   "tsx -r dotenv/config src/06-redaction/07-tracing-integration.ts dotenv_config_path=../../.env",

    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@anvia/core": "workspace:*",
    "@anvia/langfuse": "workspace:*",
    "@anvia/openai": "workspace:*",
    "dotenv": "^17.4.2",
    "zod": "^4.4.3"
  },
  "devDependencies": {
    "@types/node": "^24.9.1",
    "tsx": "^4.20.6",
    "typescript": "^5.9.3"
  }
}
```

- [ ] **Step 2: Create `examples/langfuse-ops/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "baseUrl": ".",
    "noEmit": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "paths": {
      "@anvia/core": ["../../packages/core/src/index.ts"],
      "@anvia/core/agent": ["../../packages/core/src/agent/index.ts"],
      "@anvia/core/tool": ["../../packages/core/src/tool/index.ts"],
      "@anvia/core/observability": ["../../packages/core/src/observability/index.ts"],
      "@anvia/core/evals": ["../../packages/core/src/evals/index.ts"],
      "@anvia/core/completion": ["../../packages/core/src/completion/index.ts"],
      "@anvia/core/internal/agent": ["../../packages/core/src/internal/agent.ts"],
      "@anvia/core/*": ["../../packages/core/src/*/index.ts"],
      "@anvia/openai": ["../../packages/provider-openai/src/index.ts"],
      "@anvia/langfuse": ["../../packages/observability-langfuse/src/index.ts"]
    }
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Create `examples/langfuse-ops/.env.example`**

```
# Langfuse credentials (required by every demo except 6 of 7 redaction demos)
LANGFUSE_PUBLIC_KEY=
LANGFUSE_SECRET_KEY=
LANGFUSE_BASE_URL=https://cloud.langfuse.com
LANGFUSE_TRACING_ENVIRONMENT=development
LANGFUSE_RELEASE=0.0.0
LANGFUSE_SERVICE_NAME=langfuse-ops

# OpenAI (required by every demo that runs a real Anvia agent)
OPENAI_API_KEY=
OPENAI_BASEURL=
ANVIA_MODEL=gpt-5
```

- [ ] **Step 4: Create `examples/langfuse-ops/.gitignore`**

```
.env
node_modules/
dist/
```

- [ ] **Step 5: Install deps and verify the package is recognized**

Run: `cd /Volumes/indrazm/anvia_hq/anvia && pnpm install --filter langfuse-ops`
Expected: install completes, no errors. The package appears in `pnpm -r ls`.

- [ ] **Step 6: Commit**

```bash
cd /Volumes/indrazm/anvia_hq/anvia
git add examples/langfuse-ops/package.json examples/langfuse-ops/tsconfig.json examples/langfuse-ops/.env.example examples/langfuse-ops/.gitignore pnpm-lock.yaml
git commit -m "feat(langfuse-ops): scaffold package with deps and tsconfig

Cookbook-style example package layout with per-feature npm scripts
and path-mapped @anvia/* to source."
```

---

## Task 2: Build the README

**Files:**
- Create: `examples/langfuse-ops/README.md`

- [ ] **Step 1: Create `examples/langfuse-ops/README.md`**

```markdown
# langfuse-ops

End-to-end showcase of every feature in `@anvia/langfuse`. Each script is a
self-contained runnable demo that hits the real Langfuse API and a real Anvia
agent, prints the artifact ID, and exits.

## Prerequisites

1. Langfuse project with public/secret keys (Cloud or self-hosted)
2. OpenAI-compatible API key
3. A `.env` at the repo root:

```
LANGFUSE_PUBLIC_KEY=pk-...
LANGFUSE_SECRET_KEY=sk-...
LANGFUSE_BASE_URL=https://cloud.langfuse.com
OPENAI_API_KEY=sk-...
ANVIA_MODEL=gpt-5
```

## Quickstart

```
pnpm --filter langfuse-ops start
```

Walks through: build a real Anvia agent, trace it, attach NUMERIC and
CATEGORICAL scores, run a one-case eval suite with the Langfuse eval reporter,
flush, then log the trace ID, score names, and the dataset name created
along the way.

## Feature catalog

| Group           | Command                                | What it shows                                              |
| --------------- | -------------------------------------- | ---------------------------------------------------------- |
| Quickstart      | `pnpm --filter langfuse-ops start`     | All-in-one: trace + score + eval + flush                   |
| Tracing         | `pnpm --filter langfuse-ops tracing`   | Default (`01-basic-trace.ts`)                              |
| Tracing 01-06   | `pnpm --filter langfuse-ops tracing:NN` | Six demos: basic / streaming / handle / tools / service / multi-turn |
| Scoring 01-05   | `pnpm --filter langfuse-ops scoring:NN` | data types / overrides / batched queue / error handling / queue depth |
| Eval reporter   | `pnpm --filter langfuse-ops eval-reporter:NN` | 7 demos of `createLangfuseEvalReporter` options + trace resolution |
| Experiments     | `pnpm --filter langfuse-ops experiments:NN` | dataset CRUD / runExperiment / runEvalAsExperiment        |
| Prompts         | `pnpm --filter langfuse-ops prompts:NN` | fetch text+chat / version+label / cache+refresh / link to trace |
| Redaction       | `pnpm --filter langfuse-ops redaction:NN` | PII redactor (default/custom/deep) + tracing integration  |

## What you'll see in Langfuse

- **Traces**: 37 demo runs spread across the `langfuse-ops` service, tagged
  with `LANGFUSE_TRACING_ENVIRONMENT` and `LANGFUSE_RELEASE`
- **Scores**: NUMERIC, CATEGORICAL, BOOLEAN with config IDs, plus the eval
  reporter's automatically named scores
- **Datasets**: one per `experiments:*` script, named after the run
- **Prompts**: every `prompts:*` script requires a prompt to exist; the
  expected names are logged in the script output

## How each script is structured

Every script:

1. Loads env (via `tsx -r dotenv/config`)
2. Calls `createTracing()` from `_support/tracing.ts` (or `createPiiRedactor()`
   for the standalone redaction demos)
3. Runs the feature
4. Logs the artifact ID(s) to stdout
5. Calls `await tracing.shutdown()` in a `finally` block

If the script runs an Anvia agent, it uses `buildSupportAgent()` from
`_support/agent.ts` so every demo behaves the same way.
```

- [ ] **Step 2: Commit**

```bash
cd /Volumes/indrazm/anvia_hq/anvia
git add examples/langfuse-ops/README.md
git commit -m "docs(langfuse-ops): add README with feature catalog"
```

---

## Task 3: Build `src/_support/env.ts`

**Files:**
- Create: `examples/langfuse-ops/src/_support/env.ts`

- [ ] **Step 1: Create the file**

```typescript
// Centralized env loading. The actual dotenv loading happens via
// `tsx -r dotenv/config ... dotenv_config_path=../../.env` in the script
// line, but every demo imports this module for typed accessors.

export function loadEnv(): void {
	// No-op. Kept for symmetry so every script reads the same way.
	// Real env loading is handled by tsx + dotenv at the process level.
}

export function requireEnv(name: string): string {
	const value = process.env[name];
	if (value === undefined || value.length === 0) {
		throw new Error(
			`Missing required env var ${name}. ` +
				`Set it in the .env at the repo root (../../.env).`,
		);
	}
	return value;
}

export function optionalEnv(name: string): string | undefined {
	const value = process.env[name];
	return value === undefined || value.length === 0 ? undefined : value;
}

export type LangfuseEnv = {
	publicKey: string;
	secretKey: string;
	baseUrl: string;
	environment: string | undefined;
	release: string | undefined;
	serviceName: string | undefined;
};

export function getLangfuseEnv(): LangfuseEnv {
	return {
		publicKey: requireEnv("LANGFUSE_PUBLIC_KEY"),
		secretKey: requireEnv("LANGFUSE_SECRET_KEY"),
		baseUrl: optionalEnv("LANGFUSE_BASE_URL") ?? "https://cloud.langfuse.com",
		environment: optionalEnv("LANGFUSE_TRACING_ENVIRONMENT"),
		release: optionalEnv("LANGFUSE_RELEASE"),
		serviceName: optionalEnv("LANGFUSE_SERVICE_NAME"),
	};
}
```

- [ ] **Step 2: Commit**

```bash
cd /Volumes/indrazm/anvia_hq/anvia
git add examples/langfuse-ops/src/_support/env.ts
git commit -m "feat(langfuse-ops): add _support/env module"
```

---

## Task 4: Build `src/_support/model.ts`

**Files:**
- Create: `examples/langfuse-ops/src/_support/model.ts`

- [ ] **Step 1: Create the file**

```typescript
import {
	AssistantContent,
	type CompletionModel,
	type CompletionRequest,
	type CompletionResponse,
	Usage,
} from "@anvia/core";
import { OpenAIClient } from "@anvia/openai";
import { optionalEnv, requireEnv } from "./env.js";

export function buildOpenAIClient(): OpenAIClient {
	return new OpenAIClient({
		apiKey: requireEnv("OPENAI_API_KEY"),
		baseUrl: optionalEnv("OPENAI_BASEURL"),
	});
}

export function defaultModel(): string {
	return optionalEnv("ANVIA_MODEL") ?? "gpt-5";
}

// Deterministic model that always returns the same text. Used by demos
// where a real LLM call would add noise and cost.
export function getStaticModel(text: string): CompletionModel {
	return {
		provider: "langfuse-ops-static",
		defaultModel: "static",
		capabilities: {
			streaming: false,
			tools: false,
			toolChoice: false,
			imageInput: false,
			documentInput: false,
			outputSchema: false,
			reasoning: false,
		},
		async completion(_request: CompletionRequest): Promise<CompletionResponse> {
			return {
				choice: [AssistantContent.text(text)],
				usage: Usage.empty(),
				rawResponse: {},
			};
		},
	};
}
```

- [ ] **Step 2: Commit**

```bash
cd /Volumes/indrazm/anvia_hq/anvia
git add examples/langfuse-ops/src/_support/model.ts
git commit -m "feat(langfuse-ops): add _support/model module with static fake"
```

---

## Task 5: Build `src/_support/agent.ts`

**Files:**
- Create: `examples/langfuse-ops/src/_support/agent.ts`

- [ ] **Step 1: Create the file**

```typescript
import type { CompletionModel } from "@anvia/core";
import { AgentBuilder } from "@anvia/core/agent";
import { createTool } from "@anvia/core/tool";
import type { LangfuseTracing } from "@anvia/langfuse";
import { z } from "zod";

// Same tool as cookbook 10_integrations/03-langfuse-tracing.ts so the
// tool-observation demo mirrors an existing real-world example.
export const getTicket = createTool({
	name: "get_ticket",
	description: "Read a support ticket from local application state.",
	input: z.object({
		id: z.string().describe("The ticket id to read."),
	}),
	output: z.object({
		id: z.string(),
		title: z.string(),
		severity: z.enum(["low", "medium", "high"]),
		summary: z.string(),
	}),
	execute: ({ id }) => ({
		id,
		title: "Checkout button disabled after address autocomplete",
		severity: "high" as const,
		summary:
			"Users can select an address, but checkout remains disabled until they reload the page.",
	}),
});

export type BuildSupportAgentOptions = {
	tracing?: LangfuseTracing;
	tools?: ReturnType<typeof createTool>[];
	instructions?: string;
};

export function buildSupportAgent(
	model: CompletionModel,
	options: BuildSupportAgentOptions = {},
) {
	const tools = options.tools ?? [];
	const agent = new AgentBuilder("support-agent", model)
		.instructions(
			options.instructions ??
				"Use tools when useful. Answer with a short engineering-focused summary.",
		)
		.tools(tools)
		.defaultMaxTurns(2);
	if (options.tracing !== undefined) {
		agent.observe(options.tracing);
	}
	return agent.build();
}
```

- [ ] **Step 2: Commit**

```bash
cd /Volumes/indrazm/anvia_hq/anvia
git add examples/langfuse-ops/src/_support/agent.ts
git commit -m "feat(langfuse-ops): add _support/agent module with get_ticket tool"
```

---

## Task 6: Build `src/_support/tracing.ts`

**Files:**
- Create: `examples/langfuse-ops/src/_support/tracing.ts`

- [ ] **Step 1: Create the file**

```typescript
import type {
	LangfuseRedactionOptions,
	LangfuseScoreArgs,
	LangfuseTracing,
} from "@anvia/langfuse";
import { langfuse } from "@anvia/langfuse";
import { getLangfuseEnv } from "./env.js";

export type CreateTracingOptions = {
	name?: string;
	redactInputs?: boolean;
	redactOutputs?: boolean | "deep";
	redaction?: LangfuseRedactionOptions;
	scoreBatchSize?: number;
	scoreFlushIntervalMs?: number;
	scoreMaxRetries?: number;
};

export function createTracing(options: CreateTracingOptions = {}): LangfuseTracing {
	const env = getLangfuseEnv();
	return langfuse.create({
		publicKey: env.publicKey,
		secretKey: env.secretKey,
		baseUrl: env.baseUrl,
		environment: env.environment,
		release: env.release,
		serviceName: options.name ?? "langfuse-ops",
		...(options.redactInputs !== undefined ? { redactInputs: options.redactInputs } : {}),
		...(options.redactOutputs !== undefined
			? { redactOutputs: options.redactOutputs }
			: {}),
		...(options.redaction !== undefined ? { redaction: options.redaction } : {}),
		...(options.scoreBatchSize !== undefined
			? { scoreBatchSize: options.scoreBatchSize }
			: {}),
		...(options.scoreFlushIntervalMs !== undefined
			? { scoreFlushIntervalMs: options.scoreFlushIntervalMs }
			: {}),
		...(options.scoreMaxRetries !== undefined
			? { scoreMaxRetries: options.scoreMaxRetries }
			: {}),
	});
}

// Re-exported for convenience so demo scripts only need one import path.
export type { LangfuseScoreArgs };
```

- [ ] **Step 2: Commit**

```bash
cd /Volumes/indrazm/anvia_hq/anvia
git add examples/langfuse-ops/src/_support/tracing.ts
git commit -m "feat(langfuse-ops): add _support/tracing module"
```

---

## Task 7: Build `src/00-quickstart.ts`

**Files:**
- Create: `examples/langfuse-ops/src/00-quickstart.ts`

- [ ] **Step 1: Create the file**

```typescript
// One-shot end-to-end demo: build a real Anvia agent, trace it, attach scores,
// run a one-case eval suite with the Langfuse eval reporter, flush, then log
// every artifact ID.

import { AgentBuilder } from "@anvia/core/agent";
import {
	createLangfuseDatasetClient,
	createLangfuseEvalReporter,
} from "@anvia/langfuse";
import { agentEvalTarget, contains, runEvalSuite } from "@anvia/core/evals";
import { buildSupportAgent, getTicket } from "./_support/agent.js";
import { buildOpenAIClient, defaultModel } from "./_support/model.js";
import { createTracing } from "./_support/tracing.js";

async function main(): Promise<void> {
	const tracing = createTracing({ name: "langfuse-ops-quickstart" });
	try {
		const client = buildOpenAIClient();
		const agent = buildSupportAgent(client.completionModel(defaultModel()), {
			tracing,
			tools: [getTicket],
		});

		const response = await agent
			.prompt("Summarize ticket TICKET-1001 for the product engineering team.")
			.withTrace({
				name: "quickstart-support-ticket",
				userId: "quickstart-user",
				sessionId: "quickstart-session",
				metadata: { example: "00-quickstart" },
				tags: ["langfuse-ops", "quickstart"],
			})
			.send();

		console.log("[quickstart] agent output:", response.output);
		console.log("[quickstart] trace:", response.trace?.traceId);

		if (response.trace?.traceId !== undefined) {
			await tracing.score({
				traceId: response.trace.traceId,
				name: "quality",
				value: 0.92,
				dataType: "NUMERIC",
				comment: "Heuristic quality score from quickstart demo",
			});
			await tracing.score({
				traceId: response.trace.traceId,
				name: "verdict",
				value: "pass",
				dataType: "CATEGORICAL",
				configId: "quickstart-verdict",
			});
		}

		const evalAgent = new AgentBuilder("eval-target", client.completionModel(defaultModel()))
			.instructions("Answer with a short factual sentence.")
			.defaultMaxTurns(1)
			.build();
		const evalResult = await runEvalSuite({
			name: "quickstart-suite",
			cases: [
				{
					id: "q-1",
					input: "How long do refunds stay available?",
					expected: "30 days",
				},
			],
			target: agentEvalTarget(evalAgent),
			metrics: [contains()],
			reporters: [createLangfuseEvalReporter(tracing)],
		});
		console.log("[quickstart] eval result:", evalResult.results[0]?.metrics[0]);

		const datasetClient = createLangfuseDatasetClient(tracing);
		await datasetClient.createDataset({ name: "quickstart-dataset" });
		console.log("[quickstart] dataset: quickstart-dataset");
	} finally {
		await tracing.shutdown();
	}
}

main().catch((error: unknown) => {
	console.error("[quickstart] failed:", error);
	process.exit(1);
});
```

- [ ] **Step 2: Commit**

```bash
cd /Volumes/indrazm/anvia_hq/anvia
git add examples/langfuse-ops/src/00-quickstart.ts
git commit -m "feat(langfuse-ops): add 00-quickstart end-to-end demo"
```

---

## Task 8: Build `src/01-tracing/` (6 files)

**Files:**
- Create: `examples/langfuse-ops/src/01-tracing/01-basic-trace.ts`
- Create: `examples/langfuse-ops/src/01-tracing/02-streaming-deltas.ts`
- Create: `examples/langfuse-ops/src/01-tracing/03-trace-handle.ts`
- Create: `examples/langfuse-ops/src/01-tracing/04-tool-observations.ts`
- Create: `examples/langfuse-ops/src/01-tracing/05-service-name.ts`
- Create: `examples/langfuse-ops/src/01-tracing/06-multi-turn.ts`

- [ ] **Step 1: Create `01-basic-trace.ts`**

```typescript
// Demonstrates: langfuse.create, .observe(tracing), withTrace(...), flush, shutdown.

import { buildSupportAgent } from "../_support/agent.js";
import { buildOpenAIClient, defaultModel } from "../_support/model.js";
import { createTracing } from "../_support/tracing.js";

async function main(): Promise<void> {
	const tracing = createTracing({ name: "langfuse-ops-tracing-01" });
	try {
		const client = buildOpenAIClient();
		const agent = buildSupportAgent(client.completionModel(defaultModel()), { tracing });

		const response = await agent
			.prompt("Summarize ticket TICKET-1001.")
			.withTrace({
				name: "support-ticket-summary",
				userId: "user-001",
				sessionId: "session-001",
				metadata: { ticketId: "TICKET-1001" },
				tags: ["tracing:01", "basic"],
			})
			.send();

		console.log("[tracing:01] output:", response.output);
		console.log("[tracing:01] traceId:", response.trace?.traceId);
	} finally {
		await tracing.flush();
		await tracing.shutdown();
	}
}

main().catch((error: unknown) => {
	console.error("[tracing:01] failed:", error);
	process.exit(1);
});
```

- [ ] **Step 2: Create `02-streaming-deltas.ts`**

```typescript
// Demonstrates: streaming agent output and the text_delta/reasoning_delta/
// tool_call updates on the generation observation in Langfuse.

import { buildSupportAgent } from "../_support/agent.js";
import { buildOpenAIClient, defaultModel } from "../_support/model.js";
import { createTracing } from "../_support/tracing.js";

async function main(): Promise<void> {
	const tracing = createTracing({ name: "langfuse-ops-tracing-02" });
	try {
		const client = buildOpenAIClient();
		const agent = buildSupportAgent(client.completionModel(defaultModel()), { tracing });

		const stream = await agent
			.prompt("Give me a one-paragraph summary of ticket TICKET-1001.")
			.withTrace({ name: "streaming-trace", tags: ["tracing:02", "streaming"] })
			.stream();

		let textLength = 0;
		for await (const event of stream) {
			if (event.type === "text_delta") {
				textLength += event.delta.length;
			}
		}
		console.log("[tracing:02] streamed text length:", textLength);
		console.log(
			"[tracing:02] inspect the trace in Langfuse to see text_delta updates",
		);
	} finally {
		await tracing.shutdown();
	}
}

main().catch((error: unknown) => {
	console.error("[tracing:02] failed:", error);
	process.exit(1);
});
```

- [ ] **Step 3: Create `03-trace-handle.ts`**

```typescript
// Demonstrates: getCurrentTrace(), addEvent, addAttributes, and the
// run.event?() hook for ad-hoc checkpoints.

import { buildSupportAgent } from "../_support/agent.js";
import { buildOpenAIClient, defaultModel } from "../_support/model.js";
import { createTracing } from "../_support/tracing.js";

async function main(): Promise<void> {
	const tracing = createTracing({ name: "langfuse-ops-tracing-03" });
	try {
		const client = buildOpenAIClient();
		const agent = buildSupportAgent(client.completionModel(defaultModel()), { tracing });

		const run = await agent
			.prompt("Summarize ticket TICKET-1001.")
			.withTrace({ name: "trace-handle-demo", tags: ["tracing:03"] })
			.start();

		const handle = tracing.getCurrentTrace();
		handle?.addEvent("checkpoint.started", { phase: "pre-inference" });
		handle?.addAttributes({ quality: "high" });

		await run.event?.({ name: "checkpoint.inference", attributes: { phase: "llm" } });

		const response = await run.send();
		handle?.addEvent("checkpoint.done", { outputLength: response.output.length });

		console.log("[tracing:03] output:", response.output);
		console.log("[tracing:03] traceId:", response.trace?.traceId);
	} finally {
		await tracing.shutdown();
	}
}

main().catch((error: unknown) => {
	console.error("[tracing:03] failed:", error);
	process.exit(1);
});
```

- [ ] **Step 4: Create `04-tool-observations.ts`**

```typescript
// Demonstrates: tool observations in Langfuse. The tool span carries
// toolDefinition, toolMetadata, and structuredResult on the matching
// observation in the trace.

import { buildSupportAgent, getTicket } from "../_support/agent.js";
import { buildOpenAIClient, defaultModel } from "../_support/model.js";
import { createTracing } from "../_support/tracing.js";

async function main(): Promise<void> {
	const tracing = createTracing({ name: "langfuse-ops-tracing-04" });
	try {
		const client = buildOpenAIClient();
		const agent = buildSupportAgent(client.completionModel(defaultModel()), {
			tracing,
			tools: [getTicket],
		});

		const response = await agent
			.prompt("Look up ticket TICKET-1001 and summarize the issue.")
			.withTrace({ name: "tool-observations-demo", tags: ["tracing:04"] })
			.send();

		console.log("[tracing:04] output:", response.output);
		console.log(
			"[tracing:04] inspect the trace to see the tool span with toolDefinition, toolMetadata, and structuredResult",
		);
	} finally {
		await tracing.shutdown();
	}
}

main().catch((error: unknown) => {
	console.error("[tracing:04] failed:", error);
	process.exit(1);
});
```

- [ ] **Step 5: Create `05-service-name.ts`**

```typescript
// Demonstrates: serviceName flowing into the OTel `service.name` resource
// attribute and onto the root run observation.

import { buildSupportAgent } from "../_support/agent.js";
import { buildOpenAIClient, defaultModel } from "../_support/model.js";
import { createTracing } from "../_support/tracing.js";

async function main(): Promise<void> {
	const tracing = createTracing({ name: "langfuse-ops-tracing-05" });
	try {
		const client = buildOpenAIClient();
		const agent = buildSupportAgent(client.completionModel(defaultModel()), { tracing });

		const response = await agent
			.prompt("Summarize ticket TICKET-1001.")
			.withTrace({ name: "service-name-demo", tags: ["tracing:05"] })
			.send();

		console.log("[tracing:05] output:", response.output);
		console.log(
			"[tracing:05] serviceName `langfuse-ops-tracing-05` should appear in the root observation metadata",
		);
	} finally {
		await tracing.shutdown();
	}
}

main().catch((error: unknown) => {
	console.error("[tracing:05] failed:", error);
	process.exit(1);
});
```

- [ ] **Step 6: Create `06-multi-turn.ts`**

```typescript
// Demonstrates: a multi-turn agent run, where the trace spans multiple
// generations and may show cache hits on the second turn.

import { buildSupportAgent } from "../_support/agent.js";
import { buildOpenAIClient, defaultModel } from "../_support/model.js";
import { createTracing } from "../_support/tracing.js";

async function main(): Promise<void> {
	const tracing = createTracing({ name: "langfuse-ops-tracing-06" });
	try {
		const client = buildOpenAIClient();
		const agent = buildSupportAgent(client.completionModel(defaultModel()), { tracing });

		const first = await agent
			.prompt("What ticket is TICKET-1001 about? Give a one-line summary.")
			.withTrace({ name: "multi-turn-demo", tags: ["tracing:06", "turn-1"] })
			.send();
		console.log("[tracing:06] turn 1:", first.output);

		const second = await agent
			.prompt("Now rewrite the summary in two sentences.")
			.withTrace({ name: "multi-turn-demo", tags: ["tracing:06", "turn-2"] })
			.send();
		console.log("[tracing:06] turn 2:", second.output);
	} finally {
		await tracing.shutdown();
	}
}

main().catch((error: unknown) => {
	console.error("[tracing:06] failed:", error);
	process.exit(1);
});
```

- [ ] **Step 7: Run typecheck on the new files**

Run: `cd /Volumes/indrazm/anvia_hq/anvia && pnpm --filter langfuse-ops typecheck 2>&1 | tail -40`
Expected: `Done` with no errors.

- [ ] **Step 8: Commit**

```bash
cd /Volumes/indrazm/anvia_hq/anvia
git add examples/langfuse-ops/src/01-tracing
git commit -m "feat(langfuse-ops): add 6 tracing demos"
```

---

## Task 9: Build `src/02-scoring/` (5 files)

**Files:**
- Create: `examples/langfuse-ops/src/02-scoring/01-direct-score-types.ts`
- Create: `examples/langfuse-ops/src/02-scoring/02-score-overrides.ts`
- Create: `examples/langfuse-ops/src/02-scoring/03-batched-queue.ts`
- Create: `examples/langfuse-ops/src/02-scoring/04-score-error-handling.ts`
- Create: `examples/langfuse-ops/src/02-scoring/05-queue-depth.ts`

- [ ] **Step 1: Create `01-direct-score-types.ts`**

```typescript
// Demonstrates: tracing.score() with all three data types (NUMERIC,
// CATEGORICAL, BOOLEAN). Uses a fake traceId so the demo runs without
// needing a real prior run; in practice, wire the score to a real trace.

import { createTracing } from "../_support/tracing.js";

async function main(): Promise<void> {
	const tracing = createTracing({ name: "langfuse-ops-scoring-01" });
	try {
		const fakeTraceId = "00000000-0000-0000-0000-000000000001";

		await tracing.score({
			traceId: fakeTraceId,
			name: "latency-ms",
			value: 412,
			dataType: "NUMERIC",
		});
		await tracing.score({
			traceId: fakeTraceId,
			name: "verdict",
			value: "pass",
			dataType: "CATEGORICAL",
		});
		await tracing.score({
			traceId: fakeTraceId,
			name: "grounded",
			value: true,
			dataType: "BOOLEAN",
		});

		console.log("[scoring:01] sent 3 scores (NUMERIC, CATEGORICAL, BOOLEAN)");
	} finally {
		await tracing.shutdown();
	}
}

main().catch((error: unknown) => {
	console.error("[scoring:01] failed:", error);
	process.exit(1);
});
```

- [ ] **Step 2: Create `02-score-overrides.ts`**

```typescript
// Demonstrates: per-score configId, environment override, timestamp
// (Date and ISO), comment, and metadata.

import { createTracing } from "../_support/tracing.js";

async function main(): Promise<void> {
	const tracing = createTracing({ name: "langfuse-ops-scoring-02" });
	try {
		const fakeTraceId = "00000000-0000-0000-0000-000000000002";

		await tracing.score({
			traceId: fakeTraceId,
			name: "quality",
			value: 0.87,
			dataType: "NUMERIC",
			configId: "ops-quality-config",
			environment: "staging",
			timestamp: new Date(),
			comment: "Heuristic quality score from scoring:02 demo",
			metadata: { source: "demo", scorer: "heuristic-v1" },
		});

		await tracing.score({
			traceId: fakeTraceId,
			name: "quality-iso",
			value: 0.91,
			timestamp: "2026-06-24T12:00:00.000Z",
			configId: "ops-quality-config",
		});

		// scoreConfigId is an alias for configId
		await tracing.score({
			traceId: fakeTraceId,
			name: "quality-alias",
			value: 0.7,
			scoreConfigId: "ops-quality-config",
		});

		console.log("[scoring:02] sent 3 scores with overrides + configId aliases");
	} finally {
		await tracing.shutdown();
	}
}

main().catch((error: unknown) => {
	console.error("[scoring:02] failed:", error);
	process.exit(1);
});
```

- [ ] **Step 3: Create `03-batched-queue.ts`**

```typescript
// Demonstrates: the in-memory score queue. scoreBatchSize triggers an
// immediate flush, scoreFlushIntervalMs debounces, scoreMaxRetries
// retries 429/5xx. flushScores() drains whatever is left.

import { createTracing } from "../_support/tracing.js";

async function main(): Promise<void> {
	const tracing = createTracing({
		name: "langfuse-ops-scoring-03",
		scoreBatchSize: 5,
		scoreFlushIntervalMs: 100,
		scoreMaxRetries: 3,
	});
	try {
		const fakeTraceId = "00000000-0000-0000-0000-000000000003";
		for (let i = 0; i < 12; i += 1) {
			await tracing.score({
				traceId: fakeTraceId,
				name: `latency-${i}`,
				value: 100 + i,
			});
		}
		console.log("[scoring:03] queued 12 scores, depth =", tracing.scoreQueueDepth());
		await tracing.flushScores();
		console.log("[scoring:03] after flushScores, depth =", tracing.scoreQueueDepth());
	} finally {
		await tracing.shutdown();
	}
}

main().catch((error: unknown) => {
	console.error("[scoring:03] failed:", error);
	process.exit(1);
});
```

- [ ] **Step 4: Create `04-score-error-handling.ts`**

```typescript
// Demonstrates: catching LangfuseScoreError. To force a failure, point
// the queue at an invalid baseUrl so the POST returns a non-2xx. The
// error exposes the failed scores on `.scores` and the cause on `.cause`.

import { langfuse, LangfuseScoreError } from "@anvia/langfuse";
import { getLangfuseEnv } from "../_support/env.js";

async function main(): Promise<void> {
	const env = getLangfuseEnv();
	// Force failure: send to a clearly invalid host so the POST errors.
	const tracing = langfuse.create({
		publicKey: env.publicKey,
		secretKey: env.secretKey,
		baseUrl: "https://langfuse.invalid.example",
		scoreBatchSize: 1,
		scoreMaxRetries: 1,
	});
	try {
		const fakeTraceId = "00000000-0000-0000-0000-000000000004";
		try {
			await tracing.score({
				traceId: fakeTraceId,
				name: "will-fail",
				value: 0.5,
			});
			await tracing.flushScores();
		} catch (error: unknown) {
			if (error instanceof LangfuseScoreError) {
				console.log(
					"[scoring:04] caught LangfuseScoreError, lost scores:",
					error.scores.length,
					"cause:",
					error.cause,
				);
			} else {
				throw error;
			}
		}
	} finally {
		await tracing.shutdown();
	}
}

main().catch((error: unknown) => {
	console.error("[scoring:04] failed:", error);
	process.exit(1);
});
```

- [ ] **Step 5: Create `05-queue-depth.ts`**

```typescript
// Demonstrates: monitoring scoreQueueDepth() while scores are enqueued.

import { createTracing } from "../_support/tracing.js";

async function main(): Promise<void> {
	const tracing = createTracing({
		name: "langfuse-ops-scoring-05",
		scoreBatchSize: 100, // large batch so the queue actually fills
		scoreFlushIntervalMs: 5_000, // long debounce
	});
	try {
		const fakeTraceId = "00000000-0000-0000-0000-000000000005";
		for (let i = 0; i < 10; i += 1) {
			await tracing.score({
				traceId: fakeTraceId,
				name: `latency-${i}`,
				value: 100 + i,
			});
			console.log(`[scoring:05] after enqueue ${i + 1}, depth =`, tracing.scoreQueueDepth());
		}
		await tracing.flushScores();
		console.log("[scoring:05] final depth =", tracing.scoreQueueDepth());
	} finally {
		await tracing.shutdown();
	}
}

main().catch((error: unknown) => {
	console.error("[scoring:05] failed:", error);
	process.exit(1);
});
```

- [ ] **Step 6: Run typecheck**

Run: `cd /Volumes/indrazm/anvia_hq/anvia && pnpm --filter langfuse-ops typecheck 2>&1 | tail -40`
Expected: `Done` with no errors.

- [ ] **Step 7: Commit**

```bash
cd /Volumes/indrazm/anvia_hq/anvia
git add examples/langfuse-ops/src/02-scoring
git commit -m "feat(langfuse-ops): add 5 scoring demos"
```

---

## Task 10: Build `src/03-eval-reporter/` (7 files)

**Files:**
- Create: `examples/langfuse-ops/src/03-eval-reporter/01-basic-eval.ts`
- Create: `examples/langfuse-ops/src/03-eval-reporter/02-publish-invalid.ts`
- Create: `examples/langfuse-ops/src/03-eval-reporter/03-missing-trace.ts`
- Create: `examples/langfuse-ops/src/03-eval-reporter/04-truncate-input.ts`
- Create: `examples/langfuse-ops/src/03-eval-reporter/05-include-messages.ts`
- Create: `examples/langfuse-ops/src/03-eval-reporter/06-categorical-metric.ts`
- Create: `examples/langfuse-ops/src/03-eval-reporter/07-trace-resolution.ts`

- [ ] **Step 1: Create `01-basic-eval.ts`**

```typescript
// Demonstrates: runEvalSuite + createLangfuseEvalReporter writing scores
// to a real Langfuse trace. The case bundles a traceId in metadata so
// the reporter can resolve the trace.

import { AgentBuilder } from "@anvia/core/agent";
import { agentEvalTarget, contains, runEvalSuite } from "@anvia/core/evals";
import { createLangfuseEvalReporter } from "@anvia/langfuse";
import { getStaticModel } from "../_support/model.js";
import { createTracing } from "../_support/tracing.js";

async function main(): Promise<void> {
	const tracing = createTracing({ name: "langfuse-ops-eval-reporter-01" });
	try {
		const model = getStaticModel("Refunds are available for 30 days after purchase.");
		const agent = new AgentBuilder("support-agent", model)
			.instructions("Answer support questions from policy.")
			.build();

		const result = await runEvalSuite({
			name: "support-agent-regression",
			cases: [
				{
					id: "refund-window",
					input: "How long do refunds stay available?",
					expected: "30 days",
					metadata: {
						traceId: "00000000-0000-0000-0000-000000000011",
						observationId: "obs-refund-window",
					},
				},
			],
			target: agentEvalTarget(agent),
			metrics: [contains()],
			reporters: [createLangfuseEvalReporter(tracing)],
		});
		console.log("[eval-reporter:01] result:", result.results[0]?.metrics[0]);
	} finally {
		await tracing.shutdown();
	}
}

main().catch((error: unknown) => {
	console.error("[eval-reporter:01] failed:", error);
	process.exit(1);
});
```

- [ ] **Step 2: Create `02-publish-invalid.ts`**

```typescript
// Demonstrates: publishInvalid: true surfaces invalid outcomes as zero
// scores. By default (publishInvalid: false) invalid outcomes are
// dropped silently. We capture the scores that the reporter would have
// sent by using a fake tracing.score.

import { agentEvalTarget, EvalOutcome, runEvalSuite } from "@anvia/core/evals";
import { createLangfuseEvalReporter } from "@anvia/langfuse";
import { getStaticModel } from "../_support/model.js";
import { createTracing } from "../_support/tracing.js";

async function main(): Promise<void> {
	const tracing = createTracing({ name: "langfuse-ops-eval-reporter-02" });
	try {
		const model = getStaticModel("placeholder");
		const { AgentBuilder } = await import("@anvia/core/agent");
		const agent = new AgentBuilder("invalid-agent", model)
			.instructions("invalid")
			.build();

		const reporter = createLangfuseEvalReporter(tracing, { publishInvalid: true });
		const result = await runEvalSuite({
			name: "invalid-suite",
			cases: [
				{
					id: "invalid-case",
					input: "anything",
					expected: "something else",
					metadata: { traceId: "00000000-0000-0000-0000-000000000012" },
				},
			],
			target: agentEvalTarget(agent),
			metrics: [
				{
					name: "manual-invalid",
					evaluate: () => EvalOutcome.invalid("intentionally invalid"),
				},
			],
			reporters: [reporter],
		});
		console.log("[eval-reporter:02] outcome:", result.results[0]?.metrics[0]?.outcome);
	} finally {
		await tracing.shutdown();
	}
}

main().catch((error: unknown) => {
	console.error("[eval-reporter:02] failed:", error);
	process.exit(1);
});
```

- [ ] **Step 3: Create `03-missing-trace.ts`**

```typescript
// Demonstrates: the three onMissingTrace modes (ignore, warn, throw).
// None of the cases have a traceId, so all three modes are exercised
// in sequence by a single run.

import { AgentBuilder } from "@anvia/core/agent";
import { agentEvalTarget, contains, runEvalSuite } from "@anvia/core/evals";
import { createLangfuseEvalReporter } from "@anvia/langfuse";
import { getStaticModel } from "../_support/model.js";
import { createTracing } from "../_support/tracing.js";

async function main(): Promise<void> {
	const tracing = createTracing({ name: "langfuse-ops-eval-reporter-03" });
	try {
		const model = getStaticModel("Refunds are available for 30 days after purchase.");
		const agent = new AgentBuilder("no-trace-agent", model)
			.instructions("Answer support questions from policy.")
			.build();

		const cases = [
			{ id: "no-trace-1", input: "?", expected: "?" },
			{ id: "no-trace-2", input: "?", expected: "?" },
		];

		// ignore: dropped silently
		const ignoreResult = await runEvalSuite({
			name: "ignore-mode",
			cases,
			target: agentEvalTarget(agent),
			metrics: [contains()],
			reporters: [createLangfuseEvalReporter(tracing, { onMissingTrace: "ignore" })],
		});
		console.log("[eval-reporter:03] ignore:", ignoreResult.results[0]?.metrics[0]);

		// warn: console.warn
		const warnResult = await runEvalSuite({
			name: "warn-mode",
			cases,
			target: agentEvalTarget(agent),
			metrics: [contains()],
			reporters: [createLangfuseEvalReporter(tracing, { onMissingTrace: "warn" })],
		});
		console.log("[eval-reporter:03] warn:", warnResult.results[0]?.metrics[0]);

		// throw: rejects
		try {
			await runEvalSuite({
				name: "throw-mode",
				cases,
				target: agentEvalTarget(agent),
				metrics: [contains()],
				reporters: [createLangfuseEvalReporter(tracing, { onMissingTrace: "throw" })],
			});
			console.log("[eval-reporter:03] throw: did NOT throw (unexpected)");
		} catch (error: unknown) {
			console.log(
				"[eval-reporter:03] throw: caught",
				error instanceof Error ? error.message : error,
			);
		}
	} finally {
		await tracing.shutdown();
	}
}

main().catch((error: unknown) => {
	console.error("[eval-reporter:03] failed:", error);
	process.exit(1);
});
```

- [ ] **Step 4: Create `04-truncate-input.ts`**

```typescript
// Demonstrates: truncateInputAt caps the byte size of caseInputSummary
// and caseExpectedSummary metadata keys, appending `<truncated>`.

import { AgentBuilder } from "@anvia/core/agent";
import { agentEvalTarget, contains, runEvalSuite } from "@anvia/core/evals";
import { createLangfuseEvalReporter } from "@anvia/langfuse";
import { getStaticModel } from "../_support/model.js";
import { createTracing } from "../_support/tracing.js";

async function main(): Promise<void> {
	const tracing = createTracing({ name: "langfuse-ops-eval-reporter-04" });
	try {
		const model = getStaticModel("x");
		const agent = new AgentBuilder("truncation-agent", model)
			.instructions("x")
			.build();

		const longInput = "lorem ipsum ".repeat(500); // > 6 KB
		const result = await runEvalSuite({
			name: "truncation-suite",
			cases: [
				{
					id: "long-input",
					input: longInput,
					expected: longInput,
					metadata: { traceId: "00000000-0000-0000-0000-000000000014" },
				},
			],
			target: agentEvalTarget(agent),
			metrics: [contains()],
			reporters: [createLangfuseEvalReporter(tracing, { truncateInputAt: 256 })],
		});
		console.log("[eval-reporter:04] outcome:", result.results[0]?.metrics[0]?.outcome);
		console.log(
			"[eval-reporter:04] inspect the score metadata in Langfuse to see caseInputSummary truncated to 256 bytes with `<truncated>`",
		);
	} finally {
		await tracing.shutdown();
	}
}

main().catch((error: unknown) => {
	console.error("[eval-reporter:04] failed:", error);
	process.exit(1);
});
```

- [ ] **Step 5: Create `05-include-messages.ts`**

```typescript
// Demonstrates: includeMessages controls whether output.messages is
// included in score metadata. The case output bundles a messages array.

import { AgentBuilder } from "@anvia/core/agent";
import { agentEvalTarget, contains, runEvalSuite } from "@anvia/core/evals";
import { createLangfuseEvalReporter } from "@anvia/langfuse";
import { getStaticModel } from "../_support/model.js";
import { createTracing } from "../_support/tracing.js";

async function main(): Promise<void> {
	const tracing = createTracing({ name: "langfuse-ops-eval-reporter-05" });
	try {
		const model = getStaticModel("ok");
		const agent = new AgentBuilder("msgs-agent", model)
			.instructions("ok")
			.build();

		const result = await runEvalSuite({
			name: "msgs-suite",
			cases: [
				{
					id: "with-messages",
					input: "?",
					expected: "ok",
					metadata: {
						traceId: "00000000-0000-0000-0000-000000000015",
						// The reporter reads output.messages from the case's resolved output.
						// To attach messages here we wire them through the target.
					},
				},
			],
			target: async (input) => ({
				output: "ok",
				trace: { traceId: "00000000-0000-0000-0000-000000000015" },
				messages: [
					{ role: "user", content: String(input) },
					{ role: "assistant", content: "ok" },
				],
			}),
			metrics: [contains()],
			reporters: [
				createLangfuseEvalReporter(tracing, { includeMessages: true }),
				createLangfuseEvalReporter(tracing, { includeMessages: false }),
			],
		});
		console.log("[eval-reporter:05] outcome:", result.results[0]?.metrics[0]?.outcome);
	} finally {
		await tracing.shutdown();
	}
}

main().catch((error: unknown) => {
	console.error("[eval-reporter:05] failed:", error);
	process.exit(1);
});
```

- [ ] **Step 6: Create `06-categorical-metric.ts`**

```typescript
// Demonstrates: defineMetric({ dataType, configId, metadata }) for
// CATEGORICAL and BOOLEAN metrics. The reporter forwards dataType,
// configId, and metadata to Langfuse.

import { AgentBuilder } from "@anvia/core/agent";
import { agentEvalTarget, defineMetric, EvalOutcome, runEvalSuite } from "@anvia/core/evals";
import { createLangfuseEvalReporter } from "@anvia/langfuse";
import { getStaticModel } from "../_support/model.js";
import { createTracing } from "../_support/tracing.js";

async function main(): Promise<void> {
	const tracing = createTracing({ name: "langfuse-ops-eval-reporter-06" });
	try {
		const model = getStaticModel("ok");
		const agent = new AgentBuilder("cat-agent", model)
			.instructions("ok")
			.build();

		const categorical = defineMetric({
			name: "verdict",
			dataType: "CATEGORICAL",
			configId: "ops-verdict",
			metadata: { source: "judge-llm" },
			evaluate: () => EvalOutcome.pass("good", { score: "good" }),
		});

		const boolean = defineMetric({
			name: "grounded",
			dataType: "BOOLEAN",
			configId: "ops-grounded",
			evaluate: () => EvalOutcome.pass("yes", { score: true }),
		});

		const result = await runEvalSuite({
			name: "categorical-suite",
			cases: [
				{
					id: "cat-1",
					input: "?",
					expected: "ok",
					metadata: { traceId: "00000000-0000-0000-0000-000000000016" },
				},
			],
			target: agentEvalTarget(agent),
			metrics: [categorical, boolean],
			reporters: [createLangfuseEvalReporter(tracing)],
		});
		console.log("[eval-reporter:06] metrics:", result.results[0]?.metrics);
	} finally {
		await tracing.shutdown();
	}
}

main().catch((error: unknown) => {
	console.error("[eval-reporter:06] failed:", error);
	process.exit(1);
});
```

- [ ] **Step 7: Create `07-trace-resolution.ts`**

```typescript
// Demonstrates: the three trace resolution tiers. Each case uses a
// different tier so we can verify all three at once.

import { AgentBuilder } from "@anvia/core/agent";
import { agentEvalTarget, contains, runEvalSuite } from "@anvia/core/evals";
import { createLangfuseEvalReporter } from "@anvia/langfuse";
import { getStaticModel } from "../_support/model.js";
import { createTracing } from "../_support/tracing.js";

async function main(): Promise<void> {
	const tracing = createTracing({ name: "langfuse-ops-eval-reporter-07" });
	try {
		const model = getStaticModel("ok");
		const agent = new AgentBuilder("resolve-agent", model)
			.instructions("ok")
			.build();

		// Tier 1: output.trace (most direct, set by agent run)
		// Tier 2: case.input.trace (bundled in case input)
		// Tier 3: case.metadata.traceId / observationId
		const tier3TraceId = "00000000-0000-0000-0000-000000000017";
		const result = await runEvalSuite({
			name: "resolution-suite",
			cases: [
				{
					id: "tier-3",
					input: "ok",
					expected: "ok",
					metadata: {
						traceId: tier3TraceId,
						observationId: "obs-tier-3",
					},
				},
			],
			target: async (input) => ({
				output: String(input),
				trace: { traceId: "00000000-0000-0000-0000-000000000017a" },
			}),
			metrics: [contains()],
			reporters: [createLangfuseEvalReporter(tracing)],
		});
		console.log("[eval-reporter:07] outcome:", result.results[0]?.metrics[0]?.outcome);
	} finally {
		await tracing.shutdown();
	}
}

main().catch((error: unknown) => {
	console.error("[eval-reporter:07] failed:", error);
	process.exit(1);
});
```

- [ ] **Step 8: Run typecheck**

Run: `cd /Volumes/indrazm/anvia_hq/anvia && pnpm --filter langfuse-ops typecheck 2>&1 | tail -40`
Expected: `Done` with no errors.

- [ ] **Step 9: Commit**

```bash
cd /Volumes/indrazm/anvia_hq/anvia
git add examples/langfuse-ops/src/03-eval-reporter
git commit -m "feat(langfuse-ops): add 7 eval-reporter demos"
```

---

## Task 11: Build `src/04-experiments/` (6 files)

**Files:**
- Create: `examples/langfuse-ops/src/04-experiments/01-create-dataset.ts`
- Create: `examples/langfuse-ops/src/04-experiments/02-upsert-items.ts`
- Create: `examples/langfuse-ops/src/04-experiments/03-get-dataset.ts`
- Create: `examples/langfuse-ops/src/04-experiments/04-run-experiment.ts`
- Create: `examples/langfuse-ops/src/04-experiments/05-run-experiment-errors.ts`
- Create: `examples/langfuse-ops/src/04-experiments/06-eval-as-experiment.ts`

- [ ] **Step 1: Create `01-create-dataset.ts`**

```typescript
// Demonstrates: createLangfuseDatasetClient().createDataset({...}).
// Uses a unique name per run so the script is idempotent.

import { createLangfuseDatasetClient } from "@anvia/langfuse";
import { createTracing } from "../_support/tracing.js";

async function main(): Promise<void> {
	const tracing = createTracing({ name: "langfuse-ops-experiments-01" });
	try {
		const client = createLangfuseDatasetClient(tracing);
		const name = `langfuse-ops-create-dataset-${Date.now()}`;
		const created = await client.createDataset({
			name,
			description: "Created by langfuse-ops experiments:01",
			metadata: { source: "langfuse-ops", script: "01-create-dataset" },
		});
		console.log("[experiments:01] created dataset:", created.name);
	} finally {
		await tracing.shutdown();
	}
}

main().catch((error: unknown) => {
	console.error("[experiments:01] failed:", error);
	process.exit(1);
});
```

- [ ] **Step 2: Create `02-upsert-items.ts`**

```typescript
// Demonstrates: client.upsertItems(name, items[]). Creates a dataset
// first (idempotently) and pushes a small set of items.

import { createLangfuseDatasetClient } from "@anvia/langfuse";
import { createTracing } from "../_support/tracing.js";

async function main(): Promise<void> {
	const tracing = createTracing({ name: "langfuse-ops-experiments-02" });
	try {
		const client = createLangfuseDatasetClient(tracing);
		const name = `langfuse-ops-upsert-items-${Date.now()}`;
		await client.createDataset({ name, description: "For upsertItems demo" });
		await client.upsertItems(name, [
			{ id: "c-1", input: { q: "hi" }, expected: "hello" },
			{ id: "c-2", input: { q: "bye" }, expected: "goodbye" },
		]);
		console.log(`[experiments:02] upserted 2 items into ${name}`);
	} finally {
		await tracing.shutdown();
	}
}

main().catch((error: unknown) => {
	console.error("[experiments:02] failed:", error);
	process.exit(1);
});
```

- [ ] **Step 3: Create `03-get-dataset.ts`**

```typescript
// Demonstrates: client.getDataset(name) with pageSize. Creates a
// dataset with several items first so pagination actually exercises.

import { createLangfuseDatasetClient } from "@anvia/langfuse";
import { createTracing } from "../_support/tracing.js";

async function main(): Promise<void> {
	const tracing = createTracing({ name: "langfuse-ops-experiments-03" });
	try {
		const client = createLangfuseDatasetClient(tracing, { pageSize: 2 });
		const name = `langfuse-ops-get-dataset-${Date.now()}`;
		await client.createDataset({ name });
		const items = Array.from({ length: 5 }, (_, i) => ({
			id: `c-${i}`,
			input: { q: `q${i}` },
		}));
		await client.upsertItems(name, items);

		const dataset = await client.getDataset(name);
		console.log(`[experiments:03] fetched ${dataset.items.length} items from ${name}`);
	} finally {
		await tracing.shutdown();
	}
}

main().catch((error: unknown) => {
	console.error("[experiments:03] failed:", error);
	process.exit(1);
});
```

- [ ] **Step 4: Create `04-run-experiment.ts`**

```typescript
// Demonstrates: client.runExperiment({ datasetName, runName, run }).
// We provide items directly to skip the getDataset round trip.

import { createLangfuseDatasetClient } from "@anvia/langfuse";
import { createTracing } from "../_support/tracing.js";

async function main(): Promise<void> {
	const tracing = createTracing({ name: "langfuse-ops-experiments-04" });
	try {
		const client = createLangfuseDatasetClient(tracing);
		const datasetName = `langfuse-ops-run-experiment-${Date.now()}`;
		await client.createDataset({ name: datasetName });

		const result = await client.runExperiment({
			datasetName,
			runName: `run-${Date.now()}`,
			items: [
				{ id: "c-1", input: { q: "hi" } },
				{ id: "c-2", input: { q: "bye" } },
			],
			run: (item) => ({
				output: `answer-for-${item.id}`,
				trace: { traceId: `trace-${item.id}` },
			}),
		});
		console.log("[experiments:04] posted:", result.posted, "errors:", result.errors.length);
	} finally {
		await tracing.shutdown();
	}
}

main().catch((error: unknown) => {
	console.error("[experiments:04] failed:", error);
	process.exit(1);
});
```

- [ ] **Step 5: Create `05-run-experiment-errors.ts`**

```typescript
// Demonstrates: per-item errors. The run function throws for half the
// items; the result.errors array captures them and only successful
// items reach the batched POST.

import { createLangfuseDatasetClient } from "@anvia/langfuse";
import { createTracing } from "../_support/tracing.js";

async function main(): Promise<void> {
	const tracing = createTracing({ name: "langfuse-ops-experiments-05" });
	try {
		const client = createLangfuseDatasetClient(tracing);
		const datasetName = `langfuse-ops-run-errors-${Date.now()}`;
		await client.createDataset({ name: datasetName });

		const result = await client.runExperiment({
			datasetName,
			runName: `run-errors-${Date.now()}`,
			items: [
				{ id: "ok-1", input: { q: "ok" } },
				{ id: "bad-1", input: { q: "bad" } },
				{ id: "ok-2", input: { q: "ok2" } },
				{ id: "bad-2", input: { q: "bad2" } },
			],
			run: (item) => {
				if (item.id.startsWith("bad-")) {
					throw new Error(`intentional failure for ${item.id}`);
				}
				return { output: `answer-for-${item.id}`, trace: { traceId: `trace-${item.id}` } };
			},
		});

		console.log("[experiments:05] posted:", result.posted, "errors:", result.errors.length);
		for (const err of result.errors) {
			console.log(
				`  - ${err.itemId}:`,
				err.error instanceof Error ? err.error.message : err.error,
			);
		}
	} finally {
		await tracing.shutdown();
	}
}

main().catch((error: unknown) => {
	console.error("[experiments:05] failed:", error);
	process.exit(1);
});
```

- [ ] **Step 6: Create `06-eval-as-experiment.ts`**

```typescript
// Demonstrates: runEvalAsExperiment. Runs a one-case eval suite and
// also posts a dataset run to Langfuse.

import { agentEvalTarget, contains, runEvalSuite } from "@anvia/core/evals";
import { createLangfuseDatasetClient, runEvalAsExperiment } from "@anvia/langfuse";
import { getStaticModel } from "../_support/model.js";
import { createTracing } from "../_support/tracing.js";

async function main(): Promise<void> {
	const tracing = createTracing({ name: "langfuse-ops-experiments-06" });
	try {
		const model = getStaticModel("Refunds are available for 30 days after purchase.");
		const { AgentBuilder } = await import("@anvia/core/agent");
		const agent = new AgentBuilder("eval-target", model)
			.instructions("Answer support questions from policy.")
			.build();

		const datasetName = `langfuse-ops-eval-as-experiment-${Date.now()}`;
		const result = await runEvalAsExperiment(
			{
				name: "eval-as-experiment-suite",
				cases: [
					{
						id: "refund-window",
						input: "How long do refunds stay available?",
						expected: "30 days",
					},
				],
				target: agentEvalTarget(agent),
				metrics: [contains()],
				reporters: [],
			},
			{
				tracing,
				client: createLangfuseDatasetClient(tracing),
				datasetName,
				runName: `run-${Date.now()}`,
			},
		);
		console.log(
			"[experiments:06] suite.passed:",
			result.suite.passed,
			"datasetRun.posted:",
			result.datasetRun.posted,
		);
	} finally {
		await tracing.shutdown();
	}
}

main().catch((error: unknown) => {
	console.error("[experiments:06] failed:", error);
	process.exit(1);
});
```

- [ ] **Step 7: Run typecheck**

Run: `cd /Volumes/indrazm/anvia_hq/anvia && pnpm --filter langfuse-ops typecheck 2>&1 | tail -40`
Expected: `Done` with no errors.

- [ ] **Step 8: Commit**

```bash
cd /Volumes/indrazm/anvia_hq/anvia
git add examples/langfuse-ops/src/04-experiments
git commit -m "feat(langfuse-ops): add 6 experiments demos"
```

---

## Task 12: Build `src/05-prompts/` (5 files)

**Files:**
- Create: `examples/langfuse-ops/src/05-prompts/01-fetch-text.ts`
- Create: `examples/langfuse-ops/src/05-prompts/02-fetch-chat.ts`
- Create: `examples/langfuse-ops/src/05-prompts/03-version-and-label.ts`
- Create: `examples/langfuse-ops/src/05-prompts/04-cache-and-refresh.ts`
- Create: `examples/langfuse-ops/src/05-prompts/05-link-to-trace.ts`

- [ ] **Step 1: Create `01-fetch-text.ts`**

```typescript
// Demonstrates: getPromptText(name). Throws if the prompt is a chat prompt.
// Set LANGFUSE_TEXT_PROMPT_NAME in your .env to a text prompt that exists
// in your Langfuse project. Defaults to "support-system-text".

import { createLangfusePromptClient } from "@anvia/langfuse";
import { optionalEnv } from "../_support/env.js";
import { createTracing } from "../_support/tracing.js";

async function main(): Promise<void> {
	const tracing = createTracing({ name: "langfuse-ops-prompts-01" });
	try {
		const client = createLangfusePromptClient(tracing);
		const name = optionalEnv("LANGFUSE_TEXT_PROMPT_NAME") ?? "support-system-text";
		const text = await client.getPromptText(name);
		console.log(`[prompts:01] ${name}:`, text);
	} finally {
		await tracing.shutdown();
	}
}

main().catch((error: unknown) => {
	console.error("[prompts:01] failed:", error);
	process.exit(1);
});
```

- [ ] **Step 2: Create `02-fetch-chat.ts`**

```typescript
// Demonstrates: getPromptChat(name). Throws if the prompt is a text prompt.
// Set LANGFUSE_CHAT_PROMPT_NAME in your .env to a chat prompt that exists.

import { createLangfusePromptClient } from "@anvia/langfuse";
import { optionalEnv } from "../_support/env.js";
import { createTracing } from "../_support/tracing.js";

async function main(): Promise<void> {
	const tracing = createTracing({ name: "langfuse-ops-prompts-02" });
	try {
		const client = createLangfusePromptClient(tracing);
		const name = optionalEnv("LANGFUSE_CHAT_PROMPT_NAME") ?? "support-system-chat";
		const messages = await client.getPromptChat(name);
		console.log(`[prompts:02] ${name}:`, messages);
	} finally {
		await tracing.shutdown();
	}
}

main().catch((error: unknown) => {
	console.error("[prompts:02] failed:", error);
	process.exit(1);
});
```

- [ ] **Step 3: Create `03-version-and-label.ts`**

```typescript
// Demonstrates: getPrompt(name, { version }) and getPrompt(name, { label }).
// Set LANGFUSE_VERSIONED_PROMPT_NAME in your .env to a prompt that has
// multiple versions and labels.

import { createLangfusePromptClient } from "@anvia/langfuse";
import { optionalEnv } from "../_support/env.js";
import { createTracing } from "../_support/tracing.js";

async function main(): Promise<void> {
	const tracing = createTracing({ name: "langfuse-ops-prompts-03" });
	try {
		const client = createLangfusePromptClient(tracing);
		const name = optionalEnv("LANGFUSE_VERSIONED_PROMPT_NAME") ?? "support-system";

		const byVersion = await client.getPrompt(name, { version: 1 });
		console.log(`[prompts:03] version=1: ${byVersion.name}@${byVersion.version}`);

		const byLabel = await client.getPrompt(name, { label: "production" });
		console.log(`[prompts:03] label=production: ${byLabel.name}@${byLabel.version}`);
	} finally {
		await tracing.shutdown();
	}
}

main().catch((error: unknown) => {
	console.error("[prompts:03] failed:", error);
	process.exit(1);
});
```

- [ ] **Step 4: Create `04-cache-and-refresh.ts`**

```typescript
// Demonstrates: cacheTtlMs, the refresh: true flag, and client.refresh().

import { createLangfusePromptClient } from "@anvia/langfuse";
import { optionalEnv } from "../_support/env.js";
import { createTracing } from "../_support/tracing.js";

async function main(): Promise<void> {
	const tracing = createTracing({ name: "langfuse-ops-prompts-04" });
	try {
		const client = createLangfusePromptClient(tracing, { cacheTtlMs: 60_000 });
		const name = optionalEnv("LANGFUSE_TEXT_PROMPT_NAME") ?? "support-system-text";

		const first = await client.getPrompt(name);
		const second = await client.getPrompt(name); // cache hit
		const refreshed = await client.getPrompt(name, { refresh: true }); // re-fetch

		console.log(
			"[prompts:04]",
			`first=${first.resolvedAt.toISOString()}`,
			`second=${second.resolvedAt.toISOString()}`,
			`refreshed=${refreshed.resolvedAt.toISOString()}`,
		);

		client.refresh();
		console.log("[prompts:04] cache cleared via client.refresh()");
	} finally {
		await tracing.shutdown();
	}
}

main().catch((error: unknown) => {
	console.error("[prompts:04] failed:", error);
	process.exit(1);
});
```

- [ ] **Step 5: Create `05-link-to-trace.ts`**

```typescript
// Demonstrates: promptRef on AgentRunStartArgs (new API) and
// promptName/promptVersion on trace.metadata (legacy back-compat).
// The trace will link the generation to the prompt version.

import { createLangfusePromptClient } from "@anvia/langfuse";
import { optionalEnv } from "../_support/env.js";
import { buildSupportAgent } from "../_support/agent.js";
import { buildOpenAIClient, defaultModel } from "../_support/model.js";
import { createTracing } from "../_support/tracing.js";

async function main(): Promise<void> {
	const tracing = createTracing({ name: "langfuse-ops-prompts-05" });
	try {
		const client = createLangfusePromptClient(tracing);
		const name = optionalEnv("LANGFUSE_TEXT_PROMPT_NAME") ?? "support-system-text";
		const prompt = await client.getPrompt(name);

		const anviaClient = buildOpenAIClient();
		const agent = buildSupportAgent(anviaClient.completionModel(defaultModel()), { tracing });

		// New API: promptRef on the run
		const response = await agent
			.prompt("Summarize ticket TICKET-1001.")
			.withTrace({
				name: "prompt-link-demo",
				tags: ["prompts:05"],
				promptRef: { name: prompt.name, version: prompt.version },
			})
			.send();
		console.log("[prompts:05] output (promptRef):", response.output);

		// Legacy: promptName/promptVersion on metadata
		const response2 = await agent
			.prompt("Summarize ticket TICKET-1001.")
			.withTrace({
				name: "prompt-link-legacy",
				tags: ["prompts:05", "legacy"],
				metadata: { promptName: prompt.name, promptVersion: prompt.version },
			})
			.send();
		console.log("[prompts:05] output (metadata):", response2.output);
	} finally {
		await tracing.shutdown();
	}
}

main().catch((error: unknown) => {
	console.error("[prompts:05] failed:", error);
	process.exit(1);
});
```

- [ ] **Step 6: Run typecheck**

Run: `cd /Volumes/indrazm/anvia_hq/anvia && pnpm --filter langfuse-ops typecheck 2>&1 | tail -40`
Expected: `Done` with no errors.

- [ ] **Step 7: Commit**

```bash
cd /Volumes/indrazm/anvia_hq/anvia
git add examples/langfuse-ops/src/05-prompts
git commit -m "feat(langfuse-ops): add 5 prompts demos"
```

---

## Task 13: Build `src/06-redaction/` (7 files)

**Files:**
- Create: `examples/langfuse-ops/src/06-redaction/01-default-patterns.ts`
- Create: `examples/langfuse-ops/src/06-redaction/02-redact-object.ts`
- Create: `examples/langfuse-ops/src/06-redaction/03-redact-messages.ts`
- Create: `examples/langfuse-ops/src/06-redaction/04-custom-pattern.ts`
- Create: `examples/langfuse-ops/src/06-redaction/05-custom-replacement.ts`
- Create: `examples/langfuse-ops/src/06-redaction/06-deep-mode.ts`
- Create: `examples/langfuse-ops/src/06-redaction/07-tracing-integration.ts`

- [ ] **Step 1: Create `01-default-patterns.ts`**

```typescript
// Demonstrates: DEFAULT_PATTERNS and redactString. No tracing required
// (this demo does not call the Langfuse API) so it can run offline.

import { createPiiRedactor, DEFAULT_PATTERNS } from "@anvia/langfuse";

function main(): void {
	const redactor = createPiiRedactor();
	console.log("[redaction:01] pattern names:", redactor.patternNames());
	const samples: Array<[string, string]> = [
		["email", "Contact alice@example.com for details."],
		["credit card (Luhn-valid)", "Charge 4111 1111 1111 1111 today."],
		["ipv4", "Server at 192.168.1.42 is down."],
		["phone", "Call +1 (415) 555-0123 now."],
		["jwt", "Token: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1MSJ9.abc"],
		["api key", "Use sk-abcdef0123456789abcdef01 to authenticate."],
	];
	for (const [label, value] of samples) {
		console.log(`[redaction:01] ${label}:`, redactor.redactString(value));
	}
	console.log("[redaction:01] DEFAULT_PATTERNS count:", DEFAULT_PATTERNS.length);
}

try {
	main();
} catch (error: unknown) {
	console.error("[redaction:01] failed:", error);
	process.exit(1);
}
```

- [ ] **Step 2: Create `02-redact-object.ts`**

```typescript
// Demonstrates: redactObject on a nested object with mixed types.

import { createPiiRedactor } from "@anvia/langfuse";

function main(): void {
	const redactor = createPiiRedactor();
	const input = {
		user: {
			name: "Alice",
			email: "alice@example.com",
			contacts: [
				{ kind: "phone", value: "+1 (415) 555-0123" },
				{ kind: "ip", value: "10.0.0.1" },
			],
		},
		count: 7,
		active: true,
	};
	const redacted = redactor.redactObject(input);
	console.log("[redaction:02] input:", JSON.stringify(input, null, 2));
	console.log("[redaction:02] redacted:", JSON.stringify(redacted, null, 2));
}

try {
	main();
} catch (error: unknown) {
	console.error("[redaction:02] failed:", error);
	process.exit(1);
}
```

- [ ] **Step 3: Create `03-redact-messages.ts`**

```typescript
// Demonstrates: redactMessages on a chat history. Only `text` parts are
// redacted; non-text parts are left alone.

import { createPiiRedactor } from "@anvia/langfuse";
import { Message, UserContent } from "@anvia/core/completion";

function main(): void {
	const redactor = createPiiRedactor();
	const messages = [
		Message.system("You are a support agent."),
		Message.user([UserContent.text("Email me at alice@example.com, please.")]),
		Message.assistant("Sure, I'll reach out shortly."),
	];
	const safe = redactor.redactMessages(messages);
	console.log("[redaction:03] redacted messages:", JSON.stringify(safe, null, 2));
}

try {
	main();
} catch (error: unknown) {
	console.error("[redaction:03] failed:", error);
	process.exit(1);
}
```

- [ ] **Step 4: Create `04-custom-pattern.ts`**

```typescript
// Demonstrates: adding a custom regex pattern (e.g. SSN).

import { createPiiRedactor } from "@anvia/langfuse";

function main(): void {
	const redactor = createPiiRedactor({
		patterns: [
			{ name: "ssn", regex: /\b\d{3}-\d{2}-\d{4}\b/g },
		],
	});
	console.log("[redaction:04] pattern names:", redactor.patternNames());
	console.log(
		"[redaction:04] ssn:",
		redactor.redactString("My SSN is 123-45-6789 and my email is alice@example.com."),
	);
}

try {
	main();
} catch (error: unknown) {
	console.error("[redaction:04] failed:", error);
	process.exit(1);
}
```

- [ ] **Step 5: Create `05-custom-replacement.ts`**

```typescript
// Demonstrates: a custom replacement string instead of [REDACTED].

import { createPiiRedactor } from "@anvia/langfuse";

function main(): void {
	const redactor = createPiiRedactor({ replacement: "[HIDDEN]" });
	console.log(
		"[redaction:05] custom replacement:",
		redactor.redactString("Send to alice@example.com."),
	);
}

try {
	main();
} catch (error: unknown) {
	console.error("[redaction:05] failed:", error);
	process.exit(1);
}
```

- [ ] **Step 6: Create `06-deep-mode.ts`**

```typescript
// Demonstrates: "deep" mode. With deep=true the redactor recurses
// into nested objects and arrays (in addition to top-level strings).
// This demo uses redactObject directly to show the effect without
// needing a full tracing setup.

import { createPiiRedactor } from "@anvia/langfuse";

function main(): void {
	const deepRedactor = createPiiRedactor();
	const shallow = createPiiRedactor();
	const input = {
		level1: {
			level2: {
				level3: "Reach me at alice@example.com",
			},
		},
	};
	const recursed = deepRedactor.redactObject(input);
	const topLevel = shallow.redactObject({ value: "Reach me at alice@example.com" });
	console.log("[redaction:06] deep (recurses):", JSON.stringify(recursed));
	console.log("[redaction:06] top-level only (no recursion in redactObject):", JSON.stringify(topLevel));
}

try {
	main();
} catch (error: unknown) {
	console.error("[redaction:06] failed:", error);
	process.exit(1);
}
```

- [ ] **Step 7: Create `07-tracing-integration.ts`**

```typescript
// Demonstrates: redaction in langfuse.create(). redacts inputs, outputs,
// or both. Uses a static model so the LLM call is deterministic.

import { AgentBuilder } from "@anvia/core/agent";
import { getStaticModel } from "../_support/model.js";
import { createTracing } from "../_support/tracing.js";

async function main(): Promise<void> {
	const tracing = createTracing({
		name: "langfuse-ops-redaction-07",
		redactInputs: true,
		redactOutputs: "deep",
		redaction: { replacement: "[HIDDEN]" },
	});
	try {
		const agent = new AgentBuilder("redact-agent", getStaticModel("Reach alice@example.com"))
			.instructions("Answer support questions.")
			.observe(tracing)
			.defaultMaxTurns(1)
			.build();

		const response = await agent
			.prompt("My email is alice@example.com. What is your refund policy?")
			.withTrace({ name: "redaction-tracing-demo", tags: ["redaction:07"] })
			.send();

		console.log("[redaction:07] output:", response.output);
		console.log(
			"[redaction:07] inspect the trace - input/output strings should be redacted to [HIDDEN]",
		);
	} finally {
		await tracing.shutdown();
	}
}

main().catch((error: unknown) => {
	console.error("[redaction:07] failed:", error);
	process.exit(1);
});
```

- [ ] **Step 8: Run typecheck**

Run: `cd /Volumes/indrazm/anvia_hq/anvia && pnpm --filter langfuse-ops typecheck 2>&1 | tail -40`
Expected: `Done` with no errors.

- [ ] **Step 9: Commit**

```bash
cd /Volumes/indrazm/anvia_hq/anvia
git add examples/langfuse-ops/src/06-redaction
git commit -m "feat(langfuse-ops): add 7 redaction demos"
```

---

## Task 14: Run full typecheck

**Files:** none (verification)

- [ ] **Step 1: Run typecheck across the whole package**

Run: `cd /Volumes/indrazm/anvia_hq/anvia && pnpm --filter langfuse-ops typecheck 2>&1 | tail -40`
Expected: `Done` with no errors. Every file passes TypeScript with the path-mapped `@anvia/*` imports.

- [ ] **Step 2: Run biome check (if biome is configured for the package)**

The repo root has `biome.json`. From the repo root run `pnpm exec biome check examples/langfuse-ops 2>&1 | tail -20`. If errors appear, fix them inline (the cookbook doesn't biome-check itself, so we don't strictly need this, but it's a good sanity check).

---

## Task 15: Run quickstart smoke

**Files:** none (verification)

- [ ] **Step 1: Run the quickstart against a real Langfuse project**

Prerequisite: the user has a `.env` at the repo root with `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `OPENAI_API_KEY` (and optionally `LANGFUSE_BASE_URL`).

Run: `cd /Volumes/indrazm/anvia_hq/anvia && pnpm --filter langfuse-ops start`
Expected: the script prints the agent output, a `traceId`, the eval result, and `dataset: quickstart-dataset`. The corresponding trace, scores, and dataset appear in the Langfuse UI.

- [ ] **Step 2: Run one demo from each group to confirm path mappings work**

Run these in sequence:
```
cd /Volumes/indrazm/anvia_hq/anvia
pnpm --filter langfuse-ops tracing:01
pnpm --filter langfuse-ops scoring:01
pnpm --filter langfuse-ops eval-reporter:01
pnpm --filter langfuse-ops experiments:01
pnpm --filter langfuse-ops prompts:01
pnpm --filter langfuse-ops redaction:01
```
Expected: each prints its `[<group>:<n>]` log line. `redaction:01` is offline (does not require Langfuse credentials); the others need them.

- [ ] **Step 3: Commit (no source changes; only the lockfile if it changed)**

```bash
cd /Volumes/indrazm/anvia_hq/anvia
git status
# If there are any uncommitted changes, commit them with an appropriate message
# (likely none expected).
```

---

## Self-Review

**1. Spec coverage** (every section of the design spec has at least one task):

- Goal and non-goals -> Task 1 (scaffold) + design header
- Conventions -> Task 1 (package.json/tsconfig matches cookbook)
- Package layout -> Tasks 1-13 (every directory and file)
- Script catalog (all 37) -> Tasks 7-13 (1+6+5+7+6+5+7 = 37)
- Support module API -> Tasks 3-6 (env, model, agent, tracing)
- package.json/tsconfig/.env.example/.gitignore -> Task 1
- README -> Task 2
- Verification (typecheck + smoke) -> Tasks 14-15

**2. Placeholder scan**: no "TBD", "TODO", "similar to Task N", or "implement later" anywhere. Every step shows the full code.

**3. Type consistency**:
- `createTracing({...})` is used in every demo that needs a tracing instance; signature is consistent across all 30+ usages
- `buildSupportAgent(model, { tracing, tools, instructions })` signature is consistent
- `createLangfuseDatasetClient(tracing)`, `createLangfusePromptClient(tracing)`, `createLangfuseEvalReporter(tracing, opts?)` all use the matching types
- `tracing.score({...})` always uses the right `LangfuseScoreArgs` shape (dataType when relevant, configId vs scoreConfigId, etc.)
- File path constants: `examples/langfuse-ops/...` consistent throughout
