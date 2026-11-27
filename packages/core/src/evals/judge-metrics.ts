import type { CompletionModel } from "../completion";
import {
  abstention,
  type AbstentionOptions,
  answerRelevancy,
  type AnswerRelevancyOptions,
  faithfulness,
  type FaithfulnessOptions,
  gEval,
  type GEvalOptions,
  type GEvalParameter,
  hallucination,
  type HallucinationOptions,
  type IncludeReasonMode,
  jsonCorrectness,
  type JsonCorrectnessOptions,
  knowledgeRetention,
  type KnowledgeRetentionOptions,
  promptAlignment,
  type PromptAlignmentOptions,
  summarization,
  type SummarizationOptions,
  turnRelevancy,
  type TurnRelevancyOptions,
} from "./advanced-metrics";
import { llmJudge, type LlmJudgeOptions, llmScore, type LlmScoreOptions } from "./metrics";
import type { EvalMetric, SelectorOrValue, ValueSelector } from "./types";

export type JudgeMetricsDefaults = {
  model: CompletionModel;
  retries?: number | undefined;
  temperature?: number | undefined;
  includeReason?: IncludeReasonMode | undefined;
  strictMode?: boolean | undefined;
  required?: boolean | undefined;
};

type OptionalModel<T extends { model: CompletionModel }> = Omit<T, "model"> & {
  model?: CompletionModel | undefined;
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

/** Binds shared judge model and retry/reason defaults across all LLM-based eval metric factories. */
export function createJudgeMetrics(defaults: JudgeMetricsDefaults) {
  function withCommon<T extends { model?: CompletionModel | undefined }>(
    options: T,
  ): T & { model: CompletionModel } {
    const merged: Record<string, unknown> = {};

    if (defaults.retries !== undefined) merged.retries = defaults.retries;

    if (defaults.temperature !== undefined) merged.temperature = defaults.temperature;

    if (defaults.required !== undefined) merged.required = defaults.required;

    assignDefined(merged, options as Record<string, unknown>);
    merged.model = options.model ?? defaults.model;
    return merged as T & { model: CompletionModel };
  }

  function withAdvanced<T extends { model?: CompletionModel | undefined }>(
    options: T,
  ): T & { model: CompletionModel } {
    const merged: Record<string, unknown> = {};

    if (defaults.retries !== undefined) merged.retries = defaults.retries;

    if (defaults.temperature !== undefined) merged.temperature = defaults.temperature;

    if (defaults.includeReason !== undefined) merged.includeReason = defaults.includeReason;

    if (defaults.strictMode !== undefined) merged.strictMode = defaults.strictMode;

    if (defaults.required !== undefined) merged.required = defaults.required;

    assignDefined(merged, options as Record<string, unknown>);
    merged.model = options.model ?? defaults.model;
    return merged as T & { model: CompletionModel };
  }

  function boundHallucination<
    Input,
    Output,
    Expected = unknown,
    const Name extends string = string,
  >(
    options: OptionalModel<HallucinationOptions<Input, Output, Expected>> & {
      context: Exclude<HallucinationOptions<Input, Output, Expected>["context"], undefined>;
      name?: Name | undefined;
    },
  ): EvalMetric<Input, Output, number, Expected, Name>;
  function boundHallucination<
    Input,
    Output,
    Expected = unknown,
    const Name extends string = string,
  >(
    options?: Omit<OptionalModel<HallucinationOptions<Input, Output, Expected>>, "context"> & {
      context?: undefined;
      name?: Name | undefined;
    },
  ): EvalMetric<Input, Output, number, Expected, Name, { context: string[] }>;
  function boundHallucination<
    Input,
    Output,
    Expected = unknown,
    const Name extends string = string,
  >(
    options: OptionalModel<HallucinationOptions<Input, Output, Expected>> & {
      name?: Name | undefined;
    } = {},
  ) {
    const resolved = withAdvanced(options);

    if (resolved.context !== undefined) {
      return hallucination({
        ...resolved,
        context: resolved.context,
      });
    }

    const { context: _context, ...withoutContext } = resolved;
    return hallucination(withoutContext);
  }

  function boundFaithfulness<Input, Output, Expected = unknown, const Name extends string = string>(
    options: OptionalModel<FaithfulnessOptions<Input, Output, Expected>> & {
      retrievalContext: Exclude<
        FaithfulnessOptions<Input, Output, Expected>["retrievalContext"],
        undefined
      >;
      name?: Name | undefined;
    },
  ): EvalMetric<Input, Output, number, Expected, Name>;
  function boundFaithfulness<Input, Output, Expected = unknown, const Name extends string = string>(
    options?: Omit<
      OptionalModel<FaithfulnessOptions<Input, Output, Expected>>,
      "retrievalContext"
    > & {
      retrievalContext?: undefined;
      name?: Name | undefined;
    },
  ): EvalMetric<Input, Output, number, Expected, Name, { retrievalContext: string[] }>;
  function boundFaithfulness<Input, Output, Expected = unknown, const Name extends string = string>(
    options: OptionalModel<FaithfulnessOptions<Input, Output, Expected>> & {
      name?: Name | undefined;
    } = {},
  ) {
    const resolved = withAdvanced(options);

    if (resolved.retrievalContext !== undefined) {
      return faithfulness({
        ...resolved,
        retrievalContext: resolved.retrievalContext,
      });
    }

    const { retrievalContext: _retrievalContext, ...withoutContext } = resolved;
    return faithfulness(withoutContext);
  }

  function boundGEval<
    Input,
    Output,
    Expected = unknown,
    const Name extends string = string,
    const Params extends readonly GEvalParameter[] = readonly GEvalParameter[],
    ExpectedSelector extends ValueSelector<Input, Output, Expected, unknown> | undefined =
      undefined,
    ContextSelector extends SelectorOrValue<Input, Output, Expected, string[]> | undefined =
      undefined,
    RetrievalContextSelector extends
      | SelectorOrValue<Input, Output, Expected, string[]>
      | undefined = undefined,
  >(
    options: Omit<
      OptionalModel<GEvalOptions<Input, Output, Expected>>,
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
  > {
    return gEval(
      withAdvanced(options) as unknown as Omit<
        GEvalOptions<Input, Output, Expected>,
        "evaluationParams" | "expected" | "context" | "retrievalContext"
      > & {
        name: Name;
        evaluationParams: Params;
        expected?: ExpectedSelector;
        context?: ContextSelector;
        retrievalContext?: RetrievalContextSelector;
      },
    );
  }

  return {
    llmJudge<Input, Output, SchemaOutput, Expected = unknown, const Name extends string = string>(
      options: OptionalModel<LlmJudgeOptions<Input, Output, SchemaOutput, Expected>> & {
        name?: Name | undefined;
      },
    ) {
      return llmJudge(withCommon(options));
    },

    llmScore<Input, Output, Expected = unknown, const Name extends string = string>(
      options: OptionalModel<LlmScoreOptions<Input, Output, Expected>> & {
        name?: Name | undefined;
      },
    ) {
      return llmScore(withCommon(options));
    },

    answerRelevancy<Input, Output, Expected = unknown, const Name extends string = string>(
      options: OptionalModel<AnswerRelevancyOptions<Input, Output, Expected>> & {
        name?: Name | undefined;
      } = {},
    ) {
      return answerRelevancy(withAdvanced(options));
    },

    promptAlignment<Input, Output, Expected = unknown, const Name extends string = string>(
      options: OptionalModel<PromptAlignmentOptions<Input, Output, Expected>> & {
        name?: Name | undefined;
      },
    ) {
      return promptAlignment(withAdvanced(options));
    },

    hallucination: boundHallucination,
    faithfulness: boundFaithfulness,

    abstention<Input, Output, Expected = unknown, const Name extends string = string>(
      options: OptionalModel<AbstentionOptions<Input, Output, Expected>> & {
        name?: Name | undefined;
      },
    ) {
      const merged: Record<string, unknown> = {};

      if (defaults.retries !== undefined) merged.retries = defaults.retries;

      if (defaults.temperature !== undefined) merged.temperature = defaults.temperature;

      if (defaults.includeReason !== undefined) merged.includeReason = defaults.includeReason;

      if (defaults.required !== undefined) merged.required = defaults.required;

      assignDefined(merged, options as Record<string, unknown>);
      merged.model = options.model ?? defaults.model;
      return abstention(
        merged as AbstentionOptions<Input, Output, Expected> & { name?: Name | undefined },
      );
    },

    gEval: boundGEval,

    summarization<Input, Output, Expected = unknown, const Name extends string = string>(
      options: OptionalModel<SummarizationOptions<Input, Output, Expected>> & {
        name?: Name | undefined;
      } = {},
    ) {
      return summarization(withAdvanced(options));
    },

    turnRelevancy<Input, Output, Expected = unknown, const Name extends string = string>(
      options: OptionalModel<TurnRelevancyOptions<Input, Output, Expected>> & {
        name?: Name | undefined;
      } = {},
    ) {
      return turnRelevancy(withAdvanced(options));
    },

    knowledgeRetention<Input, Output, Expected = unknown, const Name extends string = string>(
      options: OptionalModel<KnowledgeRetentionOptions<Input, Output, Expected>> & {
        name?: Name | undefined;
      } = {},
    ) {
      return knowledgeRetention(withAdvanced(options));
    },

    jsonCorrectness<
      Input,
      Output,
      SchemaOutput,
      Expected = unknown,
      const Name extends string = string,
    >(
      options: JsonCorrectnessOptions<Input, Output, SchemaOutput, Expected> & {
        name?: Name | undefined;
      },
    ) {
      return jsonCorrectness(withAdvanced(options));
    },
  };
}

function assignDefined(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined) {
      target[key] = value;
    }
  }
}
