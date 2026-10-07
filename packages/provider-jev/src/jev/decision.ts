import {
  DecisionProviderOutputError,
  type DecisionAnswers,
  type DecisionCapabilities,
  type DecisionModel,
  type DecisionQuestion,
  type DecisionQuestions,
  type DecisionRequest,
  type DecisionResult,
  type JsonValue,
  type ModelCallOptions,
} from "@anvia/core/decision";
import { isJsonValue, Usage } from "@anvia/core/completion";
import type {
  EntryType,
  JsonValue as SdkJsonValue,
  Question,
  TypeSafeClient,
} from "@typesafe-ai/sdk";
import type { JevDecisionModelId } from "./models";
import { normalizeJevError } from "./errors";

type CompiledQuestion = {
  name: string;
  question: DecisionQuestion;
  keys: string[];
};

export class JevDecisionModel implements DecisionModel<unknown> {
  readonly provider = "jev";
  readonly capabilities: DecisionCapabilities = Object.freeze({
    questionSupport: Object.freeze({
      choice: "native",
      "multi-label": "composed",
      score: "native",
      check: "native",
    }),
    mixedQuestions: true,
    limits: Object.freeze({ maxChoiceOptions: 255, maxRubricLevels: 10 }),
  });

  constructor(
    private readonly sdk: TypeSafeClient,
    readonly modelId: JevDecisionModelId,
  ) {}

  async decision<const Questions extends DecisionQuestions>(
    request: DecisionRequest<Questions>,
    options?: ModelCallOptions,
  ): Promise<DecisionResult<Questions, unknown>> {
    const compiled: CompiledQuestion[] = [];
    const questions: [string, Question][] = [];
    for (const [index, [name, question]] of Object.entries(request.questions).entries()) {
      const key = `q${index}`;
      if (question.type === "multi-label") {
        const keys = Object.entries(question.options).map(([label, description], labelIndex) => {
          const labelKey = `${key}_${labelIndex}`;
          questions.push([
            labelKey,
            {
              type: "noul",
              instructions: {
                instructions: question.instructions,
                label,
                task: "Does this label apply to the state? Evaluate it independently of other labels.",
              },
              criteria: { true: toEntry(description) },
            },
          ]);
          return labelKey;
        });
        compiled.push({ name, question, keys });
      } else {
        const native = nativeQuestion(question);
        questions.push([key, native]);
        compiled.push({ name, question, keys: [key] });
      }
    }

    let rawResponse: unknown;
    try {
      rawResponse = await this.sdk.systemOne(
        {
          ...request.providerOptions,
          state: toEntry(request.state),
          model: this.modelId,
          questions: Object.fromEntries(questions),
        },
        {
          ...(options?.abortSignal === undefined ? {} : { signal: options.abortSignal }),
          retry: { maxRetries: 0 },
        },
      );
    } catch (error) {
      throw normalizeJevError(error, options?.abortSignal);
    }

    const fail = (message: string, questionName?: string): never => {
      throw new DecisionProviderOutputError(message, {
        provider: this.provider,
        modelId: this.modelId,
        questionName,
      });
    };
    if (!isDataObject(rawResponse) || !isDataObject(rawResponse.answers)) {
      return fail("Jev returned an invalid answer envelope.");
    }
    const rawAnswers = rawResponse.answers;
    const expectedKeys = questions.map(([key]) => key);
    if (
      Object.keys(rawAnswers).length !== expectedKeys.length ||
      expectedKeys.some((key) => !Object.hasOwn(rawAnswers, key))
    ) {
      return fail("Jev answers do not match the requested questions.");
    }
    const answers = Object.fromEntries(
      compiled.map(({ name, question, keys }) => {
        const getAnswer = (key: string | undefined): Record<string, JsonValue> => {
          const answer = key === undefined ? undefined : rawAnswers[key];
          if (!isDataObject(answer)) return fail("Jev returned an invalid answer.", name);
          return answer;
        };
        if (question.type === "multi-label") {
          const labels = Object.keys(question.options);
          const probabilities = Object.fromEntries(
            labels.map((label, index) => {
              const answer = getAnswer(keys[index]);
              if (answer.type !== "noul" || !isProbability(answer.noul)) {
                return fail("Jev returned an invalid label probability.", name);
              }
              return [label, answer.noul];
            }),
          );
          return [
            name,
            {
              type: "multi-label",
              labels: labels.filter(
                (label) => probabilities[label]! >= (question.threshold ?? 0.5),
              ),
              probabilities,
            },
          ];
        }
        const answer = getAnswer(keys[0]);
        if (question.type === "check") {
          if (answer.type !== "noul" || !isProbability(answer.noul)) {
            return fail("Jev returned an invalid boolean probability.", name);
          }
          return [name, { type: "check", probability: answer.noul }];
        }
        if (
          answer.type !== question.type ||
          !isProbability(answer.confidence) ||
          !isDataObject(answer.probabilities)
        ) {
          return fail("Jev returned an invalid choice or score answer.", name);
        }
        if (question.type === "choice") {
          if (
            typeof answer.choice !== "string" ||
            !Object.hasOwn(question.options, answer.choice)
          ) {
            return fail("Jev selected an unknown option.", name);
          }
          validateDistribution(answer.probabilities, Object.keys(question.options), () =>
            fail("Jev returned invalid choice probabilities.", name),
          );
          return [
            name,
            {
              type: "choice",
              choice: answer.choice,
              probabilities: answer.probabilities,
              confidence: answer.confidence,
            },
          ];
        }
        const levelKeys = question.rubric.map((_, index) => String(index));
        const expectedLegend = Object.fromEntries(
          question.rubric.map((level, index) => [String(index), toEntry(level)]),
        );
        if (!isDataObject(answer.legend) || !jsonEqual(answer.legend, expectedLegend)) {
          return fail("Jev returned a legend that does not match the requested rubric.", name);
        }
        const scoreProbabilities = answer.probabilities;
        validateDistribution(scoreProbabilities, levelKeys, () =>
          fail("Jev returned invalid score probabilities.", name),
        );
        if (
          typeof answer.score !== "number" ||
          !Number.isFinite(answer.score) ||
          answer.score < 0 ||
          answer.score > question.rubric.length - 1
        ) {
          return fail("Jev returned a score outside the requested rubric.", name);
        }
        return [
          name,
          {
            type: "score",
            score: answer.score,
            rubric: question.rubric,
            probabilities: levelKeys.map((key) => scoreProbabilities[key]),
            confidence: answer.confidence,
          },
        ];
      }),
    ) as DecisionAnswers<Questions>;

    const usage = rawResponse.usage;
    if (
      !isDataObject(usage) ||
      !isTokenCount(usage.input_tokens) ||
      !isTokenCount(usage.output_tokens)
    ) {
      return fail("Jev returned invalid token usage.");
    }
    return {
      answers,
      usage: {
        ...Usage.empty(),
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        totalTokens: usage.input_tokens + usage.output_tokens,
      },
      rawResponse,
    };
  }
}

function nativeQuestion(question: Exclude<DecisionQuestion, { type: "multi-label" }>): Question {
  switch (question.type) {
    case "choice":
      return {
        type: "choice",
        instructions: question.instructions,
        criteria: Object.fromEntries(
          Object.entries(question.options).map(([label, description]) => [
            label,
            toEntry(description),
          ]),
        ),
      };
    case "score":
      return {
        type: "score",
        instructions: question.instructions,
        criteria: question.rubric.map(toEntry) as [EntryType, EntryType, ...EntryType[]],
      };
    case "check":
      return { type: "noul", instructions: question.instructions };
  }
}

/** The SDK accepts text, objects, arrays, and null; preserve scalar JSON inside an object. */
function toEntry(value: JsonValue): EntryType {
  const normalized = sdkJson(value);
  return typeof normalized === "number" || typeof normalized === "boolean"
    ? { value: normalized }
    : normalized;
}

function sdkJson(value: JsonValue): SdkJsonValue {
  if (Array.isArray(value)) return value.map(sdkJson);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, sdkJson(entry)]));
  }
  return value as string | number | boolean | null;
}

function isDataObject(value: unknown): value is Record<string, JsonValue> {
  return value !== null && typeof value === "object" && !Array.isArray(value) && isJsonValue(value);
}

/** Compare validated JSON without depending on object property order. */
function jsonEqual(left: JsonValue, right: JsonValue): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => jsonEqual(value, right[index]!))
    );
  }
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object")
    return false;
  // Array.isArray does not narrow readonly JSON arrays out of the object union.
  const leftObject = left as Record<string, JsonValue>;
  const rightObject = right as Record<string, JsonValue>;
  const keys = Object.keys(leftObject);
  return (
    Object.keys(rightObject).length === keys.length &&
    keys.every(
      (key) => Object.hasOwn(rightObject, key) && jsonEqual(leftObject[key]!, rightObject[key]!),
    )
  );
}

function isProbability(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isTokenCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function validateDistribution(
  value: Record<string, JsonValue>,
  keys: string[],
  fail: () => never,
): void {
  const values = Object.values(value);
  if (
    values.length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key)) ||
    !values.every(isProbability) ||
    Math.abs(values.reduce((sum, probability) => sum + probability, 0) - 1) > 1e-5
  ) {
    fail();
  }
}
