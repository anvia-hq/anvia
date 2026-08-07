---
title: "Evals"
description: "Provider-neutral eval runner, metrics, and reporters."
section: packages
sidebar:
  group: "Reference"
  order: 10
  label: "Evals"
---
Import from `@anvia/core/evals`.

## EvalCase

```ts
type EvalCase<Input, Expected = unknown> = {
  id: string;
  input: Input;
  expected?: Expected;
  context?: string[];
  retrievalContext?: string[];
  metadata?: Record<string, JsonValue | undefined>;
};

type EvalTurn = {
  role: "user" | "assistant";
  content: string;
  metadata?: EvalMetadata;
};
```

Purpose: one input and optional expected value for an eval suite. `context` is trusted
ground-truth material for hallucination checks. `retrievalContext` is the material actually
returned by a retriever for faithfulness checks.

## EvalOutcome

```ts
type EvalOutcomeStatus = "pass" | "fail" | "invalid";

type EvalOutcome<Score = unknown> =
  | { outcome: "pass"; score?: Score; comment?: string; metadata?: EvalMetadata }
  | { outcome: "fail"; score?: Score; comment?: string; metadata?: EvalMetadata }
  | { outcome: "invalid"; reason: string; score?: Score; comment?: string; metadata?: EvalMetadata };
```

Purpose: normalized metric result. Use `EvalOutcome.pass(...)`, `EvalOutcome.fail(...)`, and `EvalOutcome.invalid(...)` to construct outcomes.

## EvalMetric

```ts
type EvalMetric<Input, Output, Score = unknown, Expected = unknown> = {
  name: string;
  dataType?: "NUMERIC" | "CATEGORICAL" | "BOOLEAN";
  configId?: string;
  scoreConfigId?: string;
  metadata?: Record<string, JsonValue | undefined>;
  evaluate(args: EvalMetricArgs<Input, Output, Expected>): EvalOutcome<Score> | Promise<EvalOutcome<Score>>;
};

type EvalMetricArgs<Input, Output, Expected = unknown> = {
  suiteName: string;
  case: EvalCase<Input, Expected>;
  output: Output;
};

type EvalMetricResult<Score = unknown> = {
  metricName: string;
  outcome: EvalOutcome<Score>;
  reporterErrors: unknown[];
};

type EvalCaseResult<Input, Output, Expected = unknown> = {
  case: EvalCase<Input, Expected>;
  output?: Output;
  targetError?: unknown;
  metrics: EvalMetricResult[];
};

function defineMetric<Input, Output, Score, Expected>(
  metric: EvalMetric<Input, Output, Score, Expected>,
): EvalMetric<Input, Output, Score, Expected>;
```

Purpose: evaluates one case output and records normalized metric results. `defineMetric` is an identity helper that preserves type inference and signals intent when adding optional annotations.

## EvalReporter

```ts
type EvalReportArgs<Input, Output, Score = unknown, Expected = unknown> = {
  run?: EvalRunContext;
  suiteName: string;
  case: EvalCase<Input, Expected>;
  output?: Output;
  targetError?: unknown;
  trace?: EvalTraceRef;
  metric: EvalMetric<Input, Output, Score, Expected>;
  outcome: EvalOutcome<Score>;
};

type EvalTraceRef = {
  traceId: string;
  observationId?: string;
  responseId?: string;
};

type EvalTraceSelector<Input, Output, Expected = unknown> = (
  args: EvalTraceSelectorArgs<Input, Output, Expected>,
) => EvalTraceRef | undefined | Promise<EvalTraceRef | undefined>;

type EvalReporter<Input = unknown, Output = unknown, Expected = unknown> = {
  onRunStart?(args: EvalRunStartArgs): void | Promise<void>;
  report(args: EvalReportArgs<Input, Output, unknown, Expected>): void | Promise<void>;
  onRunEnd?(args: EvalRunEndArgs): void | Promise<void>;
};
```

Purpose: receives each metric outcome for persistence or external reporting. `trace` identifies the
run or model observation that produced the evaluated output.

Return behavior: reporter and trace-selector errors are collected on metric results unless
`failOnReporterError` is true.

The default selector resolves trace data from `output.trace`, `case.input.trace`, or case metadata.
Use `resolveEvalTraceRef(...)` directly when building a reporter, or provide a custom selector for a
different result shape.

```ts
defaultEvalTraceSelector(args): EvalTraceRef | undefined;
resolveEvalTraceRef(args): EvalTraceRef | undefined;

type EvalScoreProjection = {
  outcome: EvalOutcomeStatus;
  value: number | string;
  numericValue?: number;
  categoricalValue?: string;
  label: string;
  explanation?: string;
};

projectEvalOutcome(outcome, dataType): EvalScoreProjection;
```

`projectEvalOutcome(...)` gives observability adapters one shared numeric/categorical projection for
pass, fail, and invalid outcomes.

## runEvalSuite

```ts
type EvalRunOptions = {
  id?: string;
  datasetName?: string;
  datasetVersion?: string;
  metadata?: EvalMetadata;
};

type EvalRunContext = EvalRunOptions & {
  id: string;
  startedAt: string;
};

type RunEvalSuiteOptions<Input, Output, Expected = unknown> = {
  name: string;
  run?: EvalRunOptions;
  cases: Array<EvalCase<Input, Expected>>;
  target: EvalTarget<Input, Output, Expected>;
  metrics: Array<EvalMetric<Input, Output, unknown, Expected>>;
  concurrency?: number;
  trace?: EvalTraceSelector<Input, Output, Expected>;
  reporters?: Array<EvalReporter<Input, Output, Expected>>;
  failOnReporterError?: boolean;
};

type EvalSuiteResult<Input, Output, Expected = unknown> = {
  name: string;
  run: EvalRunContext & { completedAt: string };
  results: Array<EvalCaseResult<Input, Output, Expected>>;
  passed: number;
  failed: number;
  invalid: number;
  durationMs: number;
  reporterErrors: unknown[];
};

function runEvalSuite<Input, Output, Expected>(
  options: RunEvalSuiteOptions<Input, Output, Expected>,
): Promise<EvalSuiteResult<Input, Output, Expected>>;
```

Purpose: runs cases through a target, evaluates each metric, calls optional reporters, and returns ordered results.

Return behavior: `runEvalSuite(...)` generates a stable run ID unless one is supplied. Target errors
become invalid metric outcomes. Reporter errors are collected unless `failOnReporterError` is true.
`EvalRunStartArgs` and `EvalRunEndArgs` let reporters persist the run lifecycle around individual
metric events.

## Built-in Metrics

```ts
type ValueSelector<Input, Output, Expected, Value> = (
  args: EvalMetricArgs<Input, Output, Expected>,
) => Value | Promise<Value>;

type SelectorOrValue<Input, Output, Expected, Value> =
  | Value
  | ValueSelector<Input, Output, Expected, Value>;

type ExactMatchOptions<Input, Output, Expected = unknown> = {
  name?: string;
  actual?: ValueSelector<Input, Output, Expected, unknown>;
  expected?: SelectorOrValue<Input, Output, Expected, unknown>;
};

type ContainsOptions<Input, Output, Expected = unknown> = {
  name?: string;
  actual?: ValueSelector<Input, Output, Expected, string>;
  expected?: SelectorOrValue<Input, Output, Expected, string | RegExp>;
};

type SemanticSimilarityOptions<Input, Output, Expected = unknown> = {
  name?: string;
  model: EmbeddingModel;
  threshold: number;
  actual?: ValueSelector<Input, Output, Expected, string>;
  expected?: SelectorOrValue<Input, Output, Expected, string>;
};

type LlmJudgeOptions<Input, Output, SchemaOutput, Expected = unknown> = {
  name?: string;
  model: CompletionModel;
  schema: ZodSchema<SchemaOutput>;
  passes(value: SchemaOutput): boolean;
  instructions?: string;
  retries?: number;
  prompt?: ValueSelector<Input, Output, Expected, string>;
};

type LlmScoreMetricScore = {
  score: number;
  feedback: string;
};

type LlmScoreOptions<Input, Output, Expected = unknown> = {
  name?: string;
  model: CompletionModel;
  threshold: number;
  criteria: string | string[];
  instructions?: string;
  retries?: number;
  prompt?: ValueSelector<Input, Output, Expected, string>;
};

exactMatch(options?: ExactMatchOptions);
contains(options?: ContainsOptions);
semanticSimilarity(options: SemanticSimilarityOptions);
llmJudge(options: LlmJudgeOptions);
llmScore(options: LlmScoreOptions);
```

Purpose: common deterministic, embedding, and LLM-as-judge eval checks.

## Research-style metrics

All model-backed metric factories accept an Anvia `CompletionModel`. Unless noted otherwise,
`threshold` defaults to `0.5`, `includeReason` defaults to `true`, and `strictMode` requires a
perfect score. `input` and `actual` selectors can adapt structured target values. Judge failures
and missing required reference data produce an `invalid` outcome.

Scores are numeric. The final explanation is stored in `outcome.comment`; intermediate evidence,
score breakdowns, and aggregate judge usage are stored in `outcome.metadata.evaluation`.

```ts
type AnswerRelevancyOptions<Input, Output, Expected = unknown> = {
  name?: string;
  model: CompletionModel;
  threshold?: number;
  strictMode?: boolean;
  includeReason?: boolean;
  retries?: number;
  input?: ValueSelector<Input, Output, Expected, string>;
  actual?: ValueSelector<Input, Output, Expected, string>;
};

answerRelevancy(options: AnswerRelevancyOptions): EvalMetric;

type PromptAlignmentOptions<Input, Output, Expected = unknown> =
  AnswerRelevancyOptions<Input, Output, Expected> & {
    promptInstructions: string[];
  };

promptAlignment(options: PromptAlignmentOptions): EvalMetric;

type JsonCorrectnessOptions<Input, Output, SchemaOutput, Expected = unknown> = {
  name?: string;
  schema: ZodSchema<SchemaOutput>;
  model?: CompletionModel;
  threshold?: number;
  strictMode?: boolean;
  includeReason?: boolean;
  retries?: number;
  actual?: ValueSelector<Input, Output, Expected, string>;
};

jsonCorrectness(options: JsonCorrectnessOptions): EvalMetric;

type HallucinationOptions<Input, Output, Expected = unknown> =
  AnswerRelevancyOptions<Input, Output, Expected> & {
    context?: string[] | ValueSelector<Input, Output, Expected, string[]>;
  };

hallucination(options: HallucinationOptions): EvalMetric;

type FaithfulnessOptions<Input, Output, Expected = unknown> =
  AnswerRelevancyOptions<Input, Output, Expected> & {
    retrievalContext?: string[] | ValueSelector<Input, Output, Expected, string[]>;
    truthsExtractionLimit?: number;
    penalizeAmbiguousClaims?: boolean;
  };

faithfulness(options: FaithfulnessOptions): EvalMetric;

type SummarizationOptions<Input, Output, Expected = unknown> =
  AnswerRelevancyOptions<Input, Output, Expected> & {
    assessmentQuestions?: string[];
    questionCount?: number;
    truthsExtractionLimit?: number;
  };

summarization(options: SummarizationOptions): EvalMetric;
```

`answerRelevancy` scores statements relevant to the input. `promptAlignment` scores prompt
instructions followed. `jsonCorrectness` parses and validates output against Zod without using an
LLM for scoring. `summarization` returns the minimum of factual alignment and source coverage.
`faithfulness` measures output claims grounded in retrieved material.

`hallucination` is lower-is-better: it scores the fraction of trusted contexts contradicted by the
output and passes at or below its threshold. In strict mode it passes only at `0`.

### G-Eval

```ts
type GEvalParameter =
  | "input"
  | "actualOutput"
  | "expectedOutput"
  | "context"
  | "retrievalContext"
  | "metadata";

type GEvalRubric = {
  scoreRange: readonly [number, number];
  expectedOutcome: string;
};

type GEvalOptions<Input, Output, Expected = unknown> = {
  name: string;
  model: CompletionModel;
  evaluationParams: GEvalParameter[];
  criteria?: string;
  evaluationSteps?: string[];
  rubric?: GEvalRubric[];
  threshold?: number;
  strictMode?: boolean;
  includeReason?: boolean;
  retries?: number;
  input?: ValueSelector<Input, Output, Expected, string>;
  actual?: ValueSelector<Input, Output, Expected, string>;
  expected?: ValueSelector<Input, Output, Expected, unknown>;
  context?: string[] | ValueSelector<Input, Output, Expected, string[]>;
  retrievalContext?: string[] | ValueSelector<Input, Output, Expected, string[]>;
};

gEval(options: GEvalOptions): EvalMetric;
```

Provide exactly one of `criteria` or `evaluationSteps`. Criteria are converted into reusable
evaluation steps. The judge produces a raw 0–10 score, or a score in the outer range of an optional
non-overlapping rubric, which is normalized to 0–1. Provider-neutral G-Eval does not require token
log probabilities.

### Conversational metrics

```ts
type TurnRelevancyOptions<Input, Output, Expected = unknown> = {
  name?: string;
  model: CompletionModel;
  threshold?: number;
  strictMode?: boolean;
  includeReason?: boolean;
  retries?: number;
  concurrency?: number;
  turns?: ValueSelector<Input, Output, Expected, EvalTurn[] | Message[]>;
  windowSize?: number;
};

type KnowledgeRetentionOptions<Input, Output, Expected = unknown> = Omit<
  TurnRelevancyOptions<Input, Output, Expected>,
  "windowSize"
>;

turnRelevancy(options: TurnRelevancyOptions): EvalMetric;
knowledgeRetention(options: KnowledgeRetentionOptions): EvalMetric;
```

Without a `turns` selector, both metrics accept an `EvalTurn[]`, an Anvia `Message[]`, or an output
such as `PromptResponse` with a `messages` array. Only text from user and assistant messages is
evaluated. `turnRelevancy` uses a sliding window of 10 interactions by default. Both metrics limit
judge calls within one metric to `concurrency` requests at a time, defaulting to `4`.

## agentEvalTarget

```ts
type AgentEvalTargetOptions<Input, Output = PromptResponse> = {
  prompt?: (input: Input, testCase: EvalCase<Input>) => string | Message;
  output?: (response: PromptResponse, testCase: EvalCase<Input>) => Output;
};

function agentEvalTarget<Input>(
  agent: Agent,
  options?: AgentEvalTargetOptions<Input, PromptResponse>,
): EvalTarget<Input, PromptResponse>;

function agentEvalTarget<Input, Output>(
  agent: Agent,
  options: AgentEvalTargetOptions<Input, Output>,
): EvalTarget<Input, Output>;
```

Purpose: adapts an `Agent` to an eval target by calling `agent.prompt(input).send()`.

Return behavior: returns the full prompt response by default, or a selected value when `options.output` is provided.

For workflow guidance, start with [Evaluations](/docs/advanced/evaluations), then continue with the
focused guides for [metric selection](/docs/advanced/eval-metrics),
[RAG quality](/docs/advanced/eval-rag-quality),
[G-Eval rubrics](/docs/advanced/eval-g-eval), and
[conversation quality](/docs/advanced/eval-conversations).
