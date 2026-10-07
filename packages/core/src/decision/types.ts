import type { JsonObject, JsonValue, Usage } from "../completion/types";
import type { ModelCallOptions } from "../model-call-options";
import type { RetrySetting } from "../retry";

/** Labels mapped to descriptions or structured criteria; null leaves a label undescribed. */
export type DecisionOptions = Readonly<Record<string, JsonValue>>;
/** Ordered levels indexed from zero. At least two levels are required. */
export type DecisionRubric = readonly [JsonValue, JsonValue, ...JsonValue[]];

export type ChoiceQuestion<Options extends DecisionOptions = DecisionOptions> = {
  readonly type: "choice";
  readonly instructions: string;
  readonly options: Options;
};

export type MultiLabelQuestion<Options extends DecisionOptions = DecisionOptions> = {
  readonly type: "multi-label";
  readonly instructions: string;
  readonly options: Options;
  /** Inclusive threshold on each label's independent probability. Defaults to 0.5. */
  readonly threshold?: number | undefined;
};

export type ScoreQuestion<Rubric extends DecisionRubric = DecisionRubric> = {
  readonly type: "score";
  readonly instructions: string;
  readonly rubric: Rubric;
};

export type CheckQuestion = {
  readonly type: "check";
  readonly instructions: string;
};

export type DecisionQuestion = ChoiceQuestion | MultiLabelQuestion | ScoreQuestion | CheckQuestion;
export type DecisionQuestions = Readonly<Record<string, DecisionQuestion>>;
export type DecisionQuestionType = DecisionQuestion["type"];

export type ChoiceAnswer<Label extends string = string> = {
  readonly type: "choice";
  readonly choice: Label;
  /** Exclusive probabilities summing to one, when reported by the provider. */
  readonly probabilities?: Readonly<Record<Label, number>> | undefined;
  /** Provider-reported confidence; not derived from the highest probability. */
  readonly confidence?: number | undefined;
};

export type MultiLabelAnswer<Label extends string = string> = {
  readonly type: "multi-label";
  readonly labels: readonly Label[];
  /** Independent probabilities; they do not need to sum to one. */
  readonly probabilities: Readonly<Record<Label, number>>;
};

export type ScoreAnswer<Rubric extends DecisionRubric = DecisionRubric> = {
  readonly type: "score";
  /** Position on the zero-indexed rubric, potentially fractional. */
  readonly score: number;
  readonly rubric: Rubric;
  /** Exclusive distribution over rubric levels, in rubric order. */
  readonly probabilities?: readonly number[] | undefined;
  readonly confidence?: number | undefined;
};

export type CheckAnswer = {
  readonly type: "check";
  /** Estimated probability of yes, between zero and one. */
  readonly probability: number;
};

export type DecisionAnswerFor<Question extends DecisionQuestion> =
  Question extends ChoiceQuestion<infer Options>
    ? ChoiceAnswer<Extract<keyof Options, string>>
    : Question extends MultiLabelQuestion<infer Options>
      ? MultiLabelAnswer<Extract<keyof Options, string>>
      : Question extends ScoreQuestion<infer Rubric>
        ? ScoreAnswer<Rubric>
        : Question extends CheckQuestion
          ? CheckAnswer
          : never;

export type DecisionAnswers<Questions extends DecisionQuestions> = {
  readonly [Name in keyof Questions]: DecisionAnswerFor<Questions[Name]>;
};

export type DecisionResult<Questions extends DecisionQuestions, RawResponse = unknown> = {
  readonly answers: DecisionAnswers<Questions>;
  /** Omitted by backends that do not report token usage. */
  readonly usage?: Usage | undefined;
  readonly rawResponse: RawResponse;
};

export type DecisionCapabilities = {
  readonly questionSupport: Readonly<
    Record<DecisionQuestionType, "native" | "composed" | "unsupported">
  >;
  readonly mixedQuestions: boolean;
  readonly limits?:
    | {
        readonly maxQuestionsPerRequest?: number | undefined;
        readonly maxChoiceOptions?: number | undefined;
        readonly maxMultiLabelOptions?: number | undefined;
        readonly maxRubricLevels?: number | undefined;
      }
    | undefined;
};

export type DecisionRequest<Questions extends DecisionQuestions = DecisionQuestions> = {
  readonly state: JsonValue;
  readonly questions: Questions;
  readonly providerOptions?: JsonObject | undefined;
};

/** One provider invocation. Call decide() for validation, retries, and cancellation. */
export interface DecisionModel<RawResponse = unknown> {
  readonly provider: string;
  readonly modelId: string;
  readonly capabilities: DecisionCapabilities;
  decision<const Questions extends DecisionQuestions>(
    request: DecisionRequest<Questions>,
    options?: ModelCallOptions,
  ): Promise<DecisionResult<Questions, RawResponse>>;
}

export type DecisionRawResponseOf<Model extends DecisionModel> =
  Model extends DecisionModel<infer RawResponse> ? RawResponse : never;

export type DecideOptions<
  Questions extends DecisionQuestions,
  Model extends DecisionModel = DecisionModel,
> = DecisionRequest<Questions> & {
  readonly model: Model;
  readonly retries?: RetrySetting | undefined;
  readonly abortSignal?: AbortSignal | undefined;
};

export type DecideBatchOptions<
  Questions extends DecisionQuestions,
  Model extends DecisionModel = DecisionModel,
> = {
  readonly model: Model;
  readonly inputs: Iterable<DecisionRequest<Questions>>;
  readonly concurrency: number;
  readonly retries?: RetrySetting | undefined;
  readonly abortSignal?: AbortSignal | undefined;
};

export type DecisionBatchItem<Questions extends DecisionQuestions, RawResponse = unknown> =
  | {
      readonly index: number;
      readonly status: "completed";
      readonly result: DecisionResult<Questions, RawResponse>;
    }
  | { readonly index: number; readonly status: "failed"; readonly error: unknown };

export type DecisionBatchResult<Questions extends DecisionQuestions, RawResponse = unknown> = {
  readonly items: readonly DecisionBatchItem<Questions, RawResponse>[];
};
