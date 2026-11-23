import { z } from "zod";
import type { JsonObject, Usage } from "../../completion";
import { Usage as UsageValue } from "../../completion";
import { throwIfAborted } from "../../internal/abort";
import { addUsage, runJudge } from "../judge";
import { EvalOutcome } from "../outcome";
import { resolveActualText } from "../selectors";
import type { EvalMetric, EvalMetricArgs, SelectorOrValue, ValueSelector } from "../types";
import {
  higherOutcome,
  jsonPrompt,
  type LlmEvalOptions,
  metricConfig,
  numericMetric,
  resolveInput,
  resolveStringList,
  shouldIncludeReason,
  toJsonValue,
  willPassHigher,
} from "./shared";

export type GEvalParameter =
  | "input"
  | "actualOutput"
  | "expectedOutput"
  | "context"
  | "retrievalContext"
  | "metadata";

export type GEvalRubric = {
  scoreRange: readonly [number, number];
  expectedOutcome: string;
};

export type GEvalOptions<Input, Output, Expected = unknown> = Omit<
  LlmEvalOptions<Input, Output, Expected>,
  "name"
> & {
  name: string;
  evaluationParams: GEvalParameter[];
  criteria?: string | undefined;
  evaluationSteps?: string[] | undefined;
  rubric?: GEvalRubric[] | undefined;
  expected?: ValueSelector<Input, Output, Expected, unknown> | undefined;
  context?: SelectorOrValue<Input, Output, Expected, string[]> | undefined;
  retrievalContext?: SelectorOrValue<Input, Output, Expected, string[]> | undefined;
};

type PreparedSteps = {
  steps: string[];
  usage: Usage;
  usageClaimed: boolean;
};

type PreparationEpoch = {
  controller: AbortController;
  promise: Promise<PreparedSteps>;
  waiters: Set<object>;
};

type GEvalCaseRequirements<
  Params extends readonly GEvalParameter[],
  ExpectedSelector,
  ContextSelector,
  RetrievalContextSelector,
> = ("expectedOutput" extends Params[number]
  ? [ExpectedSelector] extends [undefined]
    ? { expected: unknown }
    : Record<never, never>
  : Record<never, never>) &
  ("context" extends Params[number]
    ? [ContextSelector] extends [undefined]
      ? { context: string[] }
      : Record<never, never>
    : Record<never, never>) &
  ("retrievalContext" extends Params[number]
    ? [RetrievalContextSelector] extends [undefined]
      ? { retrievalContext: string[] }
      : Record<never, never>
    : Record<never, never>);

export function gEval<
  Input,
  Output,
  Expected = unknown,
  const Name extends string = string,
  const Params extends readonly GEvalParameter[] = readonly GEvalParameter[],
  ExpectedSelector extends ValueSelector<Input, Output, Expected, unknown> | undefined = undefined,
  ContextSelector extends SelectorOrValue<Input, Output, Expected, string[]> | undefined =
    undefined,
  RetrievalContextSelector extends SelectorOrValue<Input, Output, Expected, string[]> | undefined =
    undefined,
>(
  options: Omit<
    GEvalOptions<Input, Output, Expected>,
    "evaluationParams" | "expected" | "context" | "retrievalContext"
  > & {
    name: Name;
    evaluationParams: Params;
    expected?: ExpectedSelector;
    context?: ContextSelector;
    retrievalContext?: RetrievalContextSelector;
  },
): EvalMetric<
  Input,
  Output,
  number,
  Expected,
  Name,
  GEvalCaseRequirements<Params, ExpectedSelector, ContextSelector, RetrievalContextSelector>
>;
export function gEval<Input, Output, Expected = unknown, const Name extends string = string>(
  options: GEvalOptions<Input, Output, Expected> & { name: Name },
): EvalMetric<Input, Output, number, Expected, Name> {
  if (options.name.trim().length === 0) throw new TypeError("gEval name must not be empty.");

  if (options.evaluationParams.length === 0) {
    throw new TypeError("gEval requires at least one evaluation parameter.");
  }

  if ((options.criteria === undefined) === (options.evaluationSteps === undefined)) {
    throw new TypeError("gEval requires exactly one of criteria or evaluationSteps.");
  }

  if (options.criteria !== undefined && options.criteria.trim().length === 0) {
    throw new TypeError("gEval criteria must not be empty.");
  }

  if (options.evaluationSteps !== undefined && options.evaluationSteps.length === 0) {
    throw new TypeError("gEval evaluationSteps must not be empty.");
  }

  const config = metricConfig<Name>(options, options.name);
  const rubric = validateRubric(options.rubric);
  const scoreRange =
    rubric.length === 0
      ? ([0, 10] as const)
      : ([rubric[0]?.scoreRange[0] ?? 0, rubric.at(-1)?.scoreRange[1] ?? 10] as const);
  let pendingPreparation: PreparationEpoch | undefined;
  let preparedSteps: PreparedSteps | undefined;

  function acceptSteps(result: PreparedSteps, signal: AbortSignal) {
    throwIfAborted(signal);
    return { steps: [...result.steps], preparation: result };
  }

  async function resolveSteps(
    signal: AbortSignal,
  ): Promise<{ steps: string[]; preparation?: PreparedSteps }> {
    throwIfAborted(signal);

    if (options.evaluationSteps !== undefined) {
      return { steps: [...options.evaluationSteps] };
    }

    if (preparedSteps !== undefined) return acceptSteps(preparedSteps, signal);

    if (pendingPreparation === undefined) {
      const controller = new AbortController();
      const epoch: PreparationEpoch = {
        controller,
        waiters: new Set(),
        promise: Promise.resolve()
          .then(() =>
            runJudge({
              model: options.model,
              schema: z.object({ steps: z.array(z.string()) }),
              instructions:
                "Generate three or four concise evaluation steps from the criteria. Explain how the selected parameters should be judged in relation to one another.",
              prompt: jsonPrompt({
                criteria: options.criteria,
                parameters: options.evaluationParams,
              }),
              retries: config.retries,
              abortSignal: controller.signal,
            }),
          )
          .then((result) => {
            if (result.data.steps.length === 0) {
              throw new Error("G-Eval generated no evaluation steps.");
            }

            const prepared = {
              steps: [...result.data.steps],
              usage: result.usage,
              usageClaimed: false,
            };

            if (pendingPreparation === epoch) {
              preparedSteps = prepared;
              pendingPreparation = undefined;
            }

            return prepared;
          })
          .catch((error: unknown) => {
            if (pendingPreparation === epoch) pendingPreparation = undefined;

            throw error;
          }),
      };
      pendingPreparation = epoch;
    }

    const epoch = pendingPreparation;
    const token = {};
    epoch.waiters.add(token);
    return new Promise((resolve, reject) => {
      const release = () => {
        if (!epoch.waiters.delete(token)) return;

        signal.removeEventListener("abort", onAbort);

        if (pendingPreparation === epoch && epoch.waiters.size === 0) {
          pendingPreparation = undefined;
          epoch.controller.abort(signal.reason);
        }
      };
      const onAbort = () => {
        release();
        reject(signal.reason);
      };
      signal.addEventListener("abort", onAbort, { once: true });
      epoch.promise.then(
        (result) => {
          if (!epoch.waiters.has(token)) return;

          try {
            const accepted = acceptSteps(result, signal);
            release();
            resolve(accepted);
          } catch (error) {
            release();
            reject(error);
          }
        },
        (error: unknown) => {
          release();
          reject(error);
        },
      );
    });
  }

  return numericMetric(config.name, config, "higher_is_better", async (args) => {
    try {
      const parameters = await resolveGEvalParameters(options, args);
      const stepsResult = await resolveSteps(args.signal);
      const scoreResult = await runJudge({
        abortSignal: args.signal,
        model: options.model,
        schema: z.object({ score: z.number(), reason: z.string() }),
        instructions: config.strictMode
          ? "Apply the evaluation steps and return score 1 only for complete compliance, otherwise 0. Give a concise evidence-based reason."
          : `Apply the evaluation steps and return an integer score from ${scoreRange[0]} through ${scoreRange[1]}, plus a concise evidence-based reason.`,
        prompt: jsonPrompt({
          evaluationSteps: stepsResult.steps,
          rubric,
          parameters,
        }),
        retries: config.retries,
      });
      const rawScore = scoreResult.data.score;

      if (
        !Number.isFinite(rawScore) ||
        (config.strictMode && rawScore !== 0 && rawScore !== 1) ||
        (!config.strictMode && (rawScore < scoreRange[0] || rawScore > scoreRange[1]))
      ) {
        throw new RangeError(`G-Eval score ${rawScore} is outside the requested range.`);
      }

      const score = config.strictMode
        ? rawScore
        : (rawScore - scoreRange[0]) / (scoreRange[1] - scoreRange[0]);
      throwIfAborted(args.signal);
      const preparation = stepsResult.preparation;
      const setupUsage =
        preparation === undefined || preparation.usageClaimed
          ? UsageValue.empty()
          : preparation.usage;
      const usage = addUsage(setupUsage, scoreResult.usage);
      const passed = willPassHigher(score, config.threshold, config.strictMode);
      const outcome = higherOutcome({
        score,
        threshold: config.threshold,
        strictMode: config.strictMode,
        comment: shouldIncludeReason(config.includeReason, passed)
          ? scoreResult.data.reason
          : undefined,
        details: {
          evaluationSteps: stepsResult.steps,
          evaluationParams: options.evaluationParams,
          rawScore,
          scoreRange: [scoreRange[0], scoreRange[1]],
          rubric: rubric.map((entry) => ({
            scoreRange: [entry.scoreRange[0], entry.scoreRange[1]],
            expectedOutcome: entry.expectedOutcome,
          })),
        },
        usage,
      });

      if (preparation !== undefined) preparation.usageClaimed = true;

      return outcome;
    } catch (error) {
      return EvalOutcome.fromError(error);
    }
  });
}

async function resolveGEvalParameters<Input, Output, Expected>(
  options: GEvalOptions<Input, Output, Expected>,
  args: EvalMetricArgs<Input, Output, Expected>,
): Promise<JsonObject> {
  const parameters: JsonObject = {};
  for (const parameter of options.evaluationParams) {
    if (parameter === "input") parameters.input = await resolveInput(options.input, args);

    if (parameter === "actualOutput") {
      parameters.actualOutput = await resolveActualText(options.actual, args);
    }

    if (parameter === "expectedOutput") {
      const expected =
        options.expected === undefined ? args.case.expected : await options.expected(args);

      if (expected === undefined) throw new Error("G-Eval expectedOutput is missing.");

      parameters.expectedOutput = toJsonValue(expected);
    }

    if (parameter === "context") {
      parameters.context = await resolveStringList(
        options.context,
        args.case.context,
        args,
        "context",
      );
    }

    if (parameter === "retrievalContext") {
      parameters.retrievalContext = await resolveStringList(
        options.retrievalContext,
        args.case.retrievalContext,
        args,
        "retrievalContext",
      );
    }

    if (parameter === "metadata") parameters.metadata = args.case.metadata ?? {};
  }
  return parameters;
}

function validateRubric(rubric: GEvalRubric[] | undefined): GEvalRubric[] {
  if (rubric === undefined || rubric.length === 0) return [];

  const sorted = [...rubric].sort((left, right) => left.scoreRange[0] - right.scoreRange[0]);
  for (const [index, entry] of sorted.entries()) {
    const [start, end] = entry.scoreRange;

    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      end > 10 ||
      start > end
    ) {
      throw new RangeError(
        "G-Eval rubric score ranges must be ordered integers from 0 through 10.",
      );
    }

    if (entry.expectedOutcome.trim().length === 0) {
      throw new TypeError("G-Eval rubric expectedOutcome must not be empty.");
    }

    const next = sorted[index + 1];

    if (next !== undefined && end >= next.scoreRange[0]) {
      throw new RangeError("G-Eval rubric score ranges must not overlap.");
    }
  }
  const first = sorted[0];
  const last = sorted.at(-1);

  if (first !== undefined && last !== undefined && first.scoreRange[0] === last.scoreRange[1]) {
    throw new RangeError("G-Eval rubric score range must span more than one value.");
  }

  return sorted;
}
