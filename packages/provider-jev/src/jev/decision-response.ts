import { Usage } from "@anvia/core/completion";
import {
  type DecisionAnswers,
  DecisionProviderOutputError,
  type DecisionQuestions,
  type DecisionResult,
  type JsonValue,
} from "@anvia/core/decision";
import {
  isDecisionDataObject as isDataObject,
  isDecisionProbability as isProbability,
  isDecisionTokenCount as isTokenCount,
  probabilitiesSumToOne,
} from "@anvia/core/internal/provider";
import { type CompiledJevQuestion, toEntry } from "./decision-request";

export function mapJevDecisionResponse<Questions extends DecisionQuestions>(
  rawResponse: unknown,
  compiled: CompiledJevQuestion[],
  expectedKeys: readonly string[],
  modelId: string,
): DecisionResult<Questions, unknown> {
  const fail = (message: string, questionName?: string): never => {
    throw new DecisionProviderOutputError(message, {
      provider: "jev",
      modelId,
      questionName,
    });
  };

  if (!isDataObject(rawResponse) || !isDataObject(rawResponse.answers)) {
    return fail("Jev returned an invalid answer envelope.");
  }

  const rawAnswers = rawResponse.answers;

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
            labels: labels.filter((label) => probabilities[label]! >= (question.threshold ?? 0.5)),
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
        if (typeof answer.choice !== "string" || !Object.hasOwn(question.options, answer.choice)) {
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
      ) as Record<string, JsonValue>;

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
    !probabilitiesSumToOne(values)
  ) {
    fail();
  }
}
