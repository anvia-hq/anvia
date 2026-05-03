import { z } from "zod";
import type { Agent, PromptResponse } from "../agent";
import type { CompletionModel, JsonValue, Message } from "../completion";
import { cosineSimilarity, type EmbeddingModel, embedText } from "../embeddings";
import { ExtractorBuilder } from "../extractor";
import type { ZodSchema } from "../schema";

export type EvalMetadata = Record<string, JsonValue | undefined>;

export type EvalCase<Input, Expected = unknown> = {
  id: string;
  input: Input;
  expected?: Expected | undefined;
  metadata?: EvalMetadata | undefined;
};

export type EvalTarget<Input, Output, Expected = unknown> = (
  input: Input,
  testCase: EvalCase<Input, Expected>,
) => Output | Promise<Output>;

export type EvalOutcomeStatus = "pass" | "fail" | "invalid";

export type EvalOutcome<Score = unknown> =
  | {
      outcome: "pass";
      score?: Score | undefined;
      comment?: string | undefined;
      metadata?: EvalMetadata | undefined;
    }
  | {
      outcome: "fail";
      score?: Score | undefined;
      comment?: string | undefined;
      metadata?: EvalMetadata | undefined;
    }
  | {
      outcome: "invalid";
      reason: string;
      score?: Score | undefined;
      comment?: string | undefined;
      metadata?: EvalMetadata | undefined;
    };

export const EvalOutcome = {
  pass<Score>(
    score?: Score,
    options: { comment?: string | undefined; metadata?: EvalMetadata | undefined } = {},
  ): EvalOutcome<Score> {
    return {
      outcome: "pass",
      ...(score === undefined ? {} : { score }),
      ...(options.comment === undefined ? {} : { comment: options.comment }),
      ...(options.metadata === undefined ? {} : { metadata: options.metadata }),
    };
  },

  fail<Score>(
    score?: Score,
    options: { comment?: string | undefined; metadata?: EvalMetadata | undefined } = {},
  ): EvalOutcome<Score> {
    return {
      outcome: "fail",
      ...(score === undefined ? {} : { score }),
      ...(options.comment === undefined ? {} : { comment: options.comment }),
      ...(options.metadata === undefined ? {} : { metadata: options.metadata }),
    };
  },

  invalid<Score = never>(
    reason: string,
    options: {
      score?: Score | undefined;
      comment?: string | undefined;
      metadata?: EvalMetadata | undefined;
    } = {},
  ): EvalOutcome<Score> {
    return {
      outcome: "invalid",
      reason,
      ...(options.score === undefined ? {} : { score: options.score }),
      ...(options.comment === undefined ? {} : { comment: options.comment }),
      ...(options.metadata === undefined ? {} : { metadata: options.metadata }),
    };
  },
};

export type EvalMetricArgs<Input, Output, Expected = unknown> = {
  suiteName: string;
  case: EvalCase<Input, Expected>;
  output: Output;
};

export type EvalMetric<Input, Output, Score = unknown, Expected = unknown> = {
  name: string;
  evaluate(
    args: EvalMetricArgs<Input, Output, Expected>,
  ): EvalOutcome<Score> | Promise<EvalOutcome<Score>>;
};

export type EvalMetricResult<Score = unknown> = {
  metricName: string;
  outcome: EvalOutcome<Score>;
  reporterErrors: unknown[];
};

export type EvalCaseResult<Input, Output, Expected = unknown> = {
  case: EvalCase<Input, Expected>;
  output?: Output | undefined;
  targetError?: unknown;
  metrics: EvalMetricResult[];
};

export type EvalSuiteResult<Input, Output, Expected = unknown> = {
  name: string;
  results: Array<EvalCaseResult<Input, Output, Expected>>;
  passed: number;
  failed: number;
  invalid: number;
  durationMs: number;
};

export type EvalReportArgs<Input, Output, Score = unknown, Expected = unknown> = {
  suiteName: string;
  case: EvalCase<Input, Expected>;
  output?: Output | undefined;
  targetError?: unknown;
  metric: EvalMetric<Input, Output, Score, Expected>;
  outcome: EvalOutcome<Score>;
};

export type EvalReporter<Input = unknown, Output = unknown, Expected = unknown> = {
  report(args: EvalReportArgs<Input, Output, unknown, Expected>): void | Promise<void>;
};

export type RunEvalSuiteOptions<Input, Output, Expected = unknown> = {
  name: string;
  cases: Array<EvalCase<Input, Expected>>;
  target: EvalTarget<Input, Output, Expected>;
  metrics: Array<EvalMetric<NoInfer<Input>, NoInfer<Output>, unknown, NoInfer<Expected>>>;
  concurrency?: number | undefined;
  reporters?: Array<EvalReporter<NoInfer<Input>, NoInfer<Output>, NoInfer<Expected>>> | undefined;
  failOnReporterError?: boolean | undefined;
};

export async function runEvalSuite<Input, Output, Expected = unknown>(
  options: RunEvalSuiteOptions<Input, Output, Expected>,
): Promise<EvalSuiteResult<Input, Output, Expected>> {
  const startedAt = Date.now();
  const results = await mapWithConcurrency(
    options.cases,
    Math.max(1, Math.trunc(options.concurrency ?? 1)),
    (testCase) => runEvalCase(options, testCase),
  );
  const counts = countOutcomes(results);
  return {
    name: options.name,
    results,
    ...counts,
    durationMs: Date.now() - startedAt,
  };
}

export type ValueSelector<Input, Output, Expected, Value> = (
  args: EvalMetricArgs<Input, Output, Expected>,
) => Value | Promise<Value>;

export type SelectorOrValue<Input, Output, Expected, Value> =
  | Value
  | ValueSelector<Input, Output, Expected, Value>;

export type ExactMatchOptions<Input, Output, Expected = unknown> = {
  name?: string | undefined;
  actual?: ValueSelector<Input, Output, Expected, unknown> | undefined;
  expected?: SelectorOrValue<Input, Output, Expected, unknown> | undefined;
};

export function exactMatch<Input, Output, Expected = unknown>(
  options: ExactMatchOptions<Input, Output, Expected> = {},
): EvalMetric<Input, Output, boolean, Expected> {
  return {
    name: options.name ?? "exact_match",
    async evaluate(args) {
      const actual = await resolveActual(options.actual, args);
      const expected = await resolveExpected(options.expected, args);
      if (expected === undefined) {
        return EvalOutcome.invalid("No expected value provided for exact match.");
      }
      const passed = stableComparable(actual) === stableComparable(expected);
      return passed
        ? EvalOutcome.pass(true)
        : EvalOutcome.fail(false, { comment: `Expected ${formatValue(expected)}.` });
    },
  };
}

export type ContainsOptions<Input, Output, Expected = unknown> = {
  name?: string | undefined;
  actual?: ValueSelector<Input, Output, Expected, string> | undefined;
  expected?: SelectorOrValue<Input, Output, Expected, string | RegExp> | undefined;
};

export function contains<Input, Output, Expected = unknown>(
  options: ContainsOptions<Input, Output, Expected> = {},
): EvalMetric<Input, Output, boolean, Expected> {
  return {
    name: options.name ?? "contains",
    async evaluate(args) {
      const actual = await resolveActualText(options.actual, args);
      const expected = await resolveExpected(options.expected, args);
      if (expected === undefined) {
        return EvalOutcome.invalid("No expected value provided for contains.");
      }
      if (typeof expected !== "string" && !(expected instanceof RegExp)) {
        return EvalOutcome.invalid("Contains expected value must be a string or RegExp.");
      }
      const passed = expected instanceof RegExp ? expected.test(actual) : actual.includes(expected);
      return passed
        ? EvalOutcome.pass(true)
        : EvalOutcome.fail(false, { comment: `Output did not contain ${String(expected)}.` });
    },
  };
}

export type SemanticSimilarityOptions<Input, Output, Expected = unknown> = {
  name?: string | undefined;
  model: EmbeddingModel;
  threshold: number;
  actual?: ValueSelector<Input, Output, Expected, string> | undefined;
  expected?: SelectorOrValue<Input, Output, Expected, string> | undefined;
};

export function semanticSimilarity<Input, Output, Expected = unknown>(
  options: SemanticSimilarityOptions<Input, Output, Expected>,
): EvalMetric<Input, Output, number, Expected> {
  return {
    name: options.name ?? "semantic_similarity",
    async evaluate(args) {
      const actual = await resolveActualText(options.actual, args);
      const expected = await resolveExpected(options.expected, args);
      if (expected === undefined) {
        return EvalOutcome.invalid("No expected value provided for semantic similarity.");
      }
      if (typeof expected !== "string") {
        return EvalOutcome.invalid("Semantic similarity expected value must be a string.");
      }
      const [actualEmbedding, expectedEmbedding] = await Promise.all([
        embedText(options.model, actual),
        embedText(options.model, expected),
      ]);
      const score = cosineSimilarity(actualEmbedding.vector, expectedEmbedding.vector);
      return score >= options.threshold
        ? EvalOutcome.pass(score)
        : EvalOutcome.fail(score, { comment: `Similarity below threshold ${options.threshold}.` });
    },
  };
}

export type LlmJudgeOptions<Input, Output, SchemaOutput, Expected = unknown> = {
  name?: string | undefined;
  model: CompletionModel;
  schema: ZodSchema<SchemaOutput>;
  passes(value: SchemaOutput): boolean;
  instructions?: string | undefined;
  retries?: number | undefined;
  prompt?: ValueSelector<Input, Output, Expected, string> | undefined;
};

export function llmJudge<Input, Output, SchemaOutput, Expected = unknown>(
  options: LlmJudgeOptions<Input, Output, SchemaOutput, Expected>,
): EvalMetric<Input, Output, SchemaOutput, Expected> {
  const extractor = new ExtractorBuilder(options.model, options.schema)
    .instructions(
      options.instructions ??
        "Judge the eval case by the requested schema. Submit the judgment using the schema.",
    )
    .retries(options.retries ?? 0)
    .build();

  return {
    name: options.name ?? "llm_judge",
    async evaluate(args) {
      try {
        const judgment = await extractor.extract(await resolveJudgePrompt(options.prompt, args));
        return options.passes(judgment) ? EvalOutcome.pass(judgment) : EvalOutcome.fail(judgment);
      } catch (error) {
        return EvalOutcome.invalid(errorMessage(error));
      }
    },
  };
}

export type LlmScoreMetricScore = {
  score: number;
  feedback: string;
};

export type LlmScoreOptions<Input, Output, Expected = unknown> = {
  name?: string | undefined;
  model: CompletionModel;
  threshold: number;
  criteria: string | string[];
  instructions?: string | undefined;
  retries?: number | undefined;
  prompt?: ValueSelector<Input, Output, Expected, string> | undefined;
};

export function llmScore<Input, Output, Expected = unknown>(
  options: LlmScoreOptions<Input, Output, Expected>,
): EvalMetric<Input, Output, LlmScoreMetricScore, Expected> {
  const criteria = Array.isArray(options.criteria) ? options.criteria.join("\n") : options.criteria;
  const extractor = new ExtractorBuilder(
    options.model,
    z.object({
      score: z.number(),
      feedback: z.string(),
    }),
  )
    .instructions(
      options.instructions ??
        `Score the eval case against these criteria:\n${criteria}\n\nReturn a score between 0 and 1 and brief feedback.`,
    )
    .retries(options.retries ?? 0)
    .build();

  return {
    name: options.name ?? "llm_score",
    async evaluate(args) {
      try {
        const score = await extractor.extract(await resolveJudgePrompt(options.prompt, args));
        if (score.score < 0 || score.score > 1) {
          return EvalOutcome.invalid(`Score ${score.score} outside valid range [0, 1].`, {
            score,
          });
        }
        return score.score >= options.threshold
          ? EvalOutcome.pass(score, { comment: score.feedback })
          : EvalOutcome.fail(score, { comment: score.feedback });
      } catch (error) {
        return EvalOutcome.invalid(errorMessage(error));
      }
    },
  };
}

export type AgentEvalTargetOptions<Input, Output = PromptResponse> = {
  prompt?: ((input: Input, testCase: EvalCase<Input>) => string | Message) | undefined;
  output?: ((response: PromptResponse, testCase: EvalCase<Input>) => Output) | undefined;
};

export function agentEvalTarget<Input>(
  agent: Agent,
  options?: AgentEvalTargetOptions<Input, PromptResponse>,
): EvalTarget<Input, PromptResponse>;
export function agentEvalTarget<Input, Output>(
  agent: Agent,
  options: AgentEvalTargetOptions<Input, Output>,
): EvalTarget<Input, Output>;
export function agentEvalTarget<Input, Output>(
  agent: Agent,
  options: AgentEvalTargetOptions<Input, Output | PromptResponse> = {},
): EvalTarget<Input, Output | PromptResponse> {
  return async (input, testCase) => {
    const prompt = options.prompt?.(input, testCase) ?? String(input);
    const response = await agent.prompt(prompt).send();
    return options.output === undefined ? response : options.output(response, testCase);
  };
}

async function runEvalCase<Input, Output, Expected>(
  options: RunEvalSuiteOptions<Input, Output, Expected>,
  testCase: EvalCase<Input, Expected>,
): Promise<EvalCaseResult<Input, Output, Expected>> {
  let output: Output | undefined;
  let targetError: unknown;
  try {
    output = await options.target(testCase.input, testCase);
  } catch (error) {
    targetError = error;
  }

  const metrics: EvalMetricResult[] = [];
  for (const metric of options.metrics) {
    const outcome =
      targetError === undefined
        ? await safeEvaluate(options.name, testCase, output as Output, metric)
        : EvalOutcome.invalid(`Target failed: ${errorMessage(targetError)}`);
    const reporterErrors = await reportOutcome({
      suiteName: options.name,
      testCase,
      output,
      targetError,
      metric,
      outcome,
      reporters: options.reporters ?? [],
      failOnReporterError: options.failOnReporterError === true,
    });
    metrics.push({ metricName: metric.name, outcome, reporterErrors });
  }

  return {
    case: testCase,
    ...(output === undefined ? {} : { output }),
    ...(targetError === undefined ? {} : { targetError }),
    metrics,
  };
}

async function safeEvaluate<Input, Output, Expected>(
  suiteName: string,
  testCase: EvalCase<Input, Expected>,
  output: Output,
  metric: EvalMetric<Input, Output, unknown, Expected>,
): Promise<EvalOutcome> {
  try {
    return await metric.evaluate({ suiteName, case: testCase, output });
  } catch (error) {
    return EvalOutcome.invalid(errorMessage(error));
  }
}

async function reportOutcome<Input, Output, Expected>(args: {
  suiteName: string;
  testCase: EvalCase<Input, Expected>;
  output: Output | undefined;
  targetError: unknown;
  metric: EvalMetric<Input, Output, unknown, Expected>;
  outcome: EvalOutcome;
  reporters: Array<EvalReporter<Input, Output, Expected>>;
  failOnReporterError: boolean;
}): Promise<unknown[]> {
  const errors: unknown[] = [];
  for (const reporter of args.reporters) {
    try {
      await reporter.report({
        suiteName: args.suiteName,
        case: args.testCase,
        output: args.output,
        targetError: args.targetError,
        metric: args.metric,
        outcome: args.outcome,
      });
    } catch (error) {
      if (args.failOnReporterError) {
        throw error;
      }
      errors.push(error);
    }
  }
  return errors;
}

function countOutcomes(results: Array<EvalCaseResult<unknown, unknown, unknown>>): {
  passed: number;
  failed: number;
  invalid: number;
} {
  let passed = 0;
  let failed = 0;
  let invalid = 0;
  for (const result of results) {
    for (const metric of result.metrics) {
      if (metric.outcome.outcome === "pass") passed += 1;
      if (metric.outcome.outcome === "fail") failed += 1;
      if (metric.outcome.outcome === "invalid") invalid += 1;
    }
  }
  return { passed, failed, invalid };
}

async function resolveActual<Input, Output, Expected>(
  selector: ValueSelector<Input, Output, Expected, unknown> | undefined,
  args: EvalMetricArgs<Input, Output, Expected>,
): Promise<unknown> {
  return selector === undefined ? defaultOutputValue(args.output) : selector(args);
}

async function resolveActualText<Input, Output, Expected>(
  selector: ValueSelector<Input, Output, Expected, string> | undefined,
  args: EvalMetricArgs<Input, Output, Expected>,
): Promise<string> {
  const value = selector === undefined ? defaultOutputValue(args.output) : await selector(args);
  return typeof value === "string" ? value : JSON.stringify(value);
}

async function resolveExpected<Input, Output, Expected, Value>(
  selectorOrValue: SelectorOrValue<Input, Output, Expected, Value> | undefined,
  args: EvalMetricArgs<Input, Output, Expected>,
): Promise<Value | Expected | undefined> {
  if (selectorOrValue === undefined) {
    return args.case.expected;
  }
  return typeof selectorOrValue === "function"
    ? (selectorOrValue as ValueSelector<Input, Output, Expected, Value>)(args)
    : selectorOrValue;
}

async function resolveJudgePrompt<Input, Output, Expected>(
  selector: ValueSelector<Input, Output, Expected, string> | undefined,
  args: EvalMetricArgs<Input, Output, Expected>,
): Promise<string> {
  if (selector !== undefined) {
    return selector(args);
  }
  return [
    `Suite: ${args.suiteName}`,
    `Case: ${args.case.id}`,
    `Input: ${formatValue(args.case.input)}`,
    `Expected: ${formatValue(args.case.expected)}`,
    `Output: ${formatValue(defaultOutputValue(args.output))}`,
  ].join("\n\n");
}

function defaultOutputValue(output: unknown): unknown {
  if (
    typeof output === "object" &&
    output !== null &&
    "output" in output &&
    typeof (output as { output?: unknown }).output === "string"
  ) {
    return (output as { output: string }).output;
  }
  return output;
}

function stableComparable(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value);
}

function formatValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function mapWithConcurrency<Input, Output>(
  inputs: Input[],
  concurrency: number,
  mapper: (input: Input) => Promise<Output>,
): Promise<Output[]> {
  const results = new Array<Output>(inputs.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (next < inputs.length) {
      const index = next;
      next += 1;
      results[index] = await mapper(inputs[index] as Input);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, inputs.length) }, () => worker()));
  return results;
}
