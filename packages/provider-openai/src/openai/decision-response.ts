import {
  DecisionProviderOutputError,
  DecisionRefusalError,
  type DecisionAnswers,
  type DecisionQuestions,
  type DecisionResult,
  type JsonValue,
} from "@anvia/core/decision";
import { isJsonValue } from "@anvia/core/completion";
import { isPlainObject, normalizeOpenAIUsage } from "../utils";
import type { CompiledDecisionQuestion } from "./decision-request";

export function mapDecisionResponse<Questions extends DecisionQuestions>(
  rawResponse: unknown,
  compiled: CompiledDecisionQuestion[],
  modelId: string,
): DecisionResult<Questions, unknown> {
  const fail = (message: string, questionName?: string): never => {
    throw new DecisionProviderOutputError(message, {
      provider: "OpenAI",
      modelId,
      questionName,
    });
  };
  if (
    !isPlainObject(rawResponse) ||
    !Array.isArray(rawResponse.answers) ||
    !isJsonValue(rawResponse.answers)
  ) {
    return fail("OpenAI returned an invalid decision envelope.");
  }
  const expectedKeys = new Set(compiled.flatMap(({ keys }) => keys));
  const byName = new Map<string, Record<string, JsonValue>>();
  for (const answer of rawResponse.answers) {
    if (
      !isDataObject(answer) ||
      typeof answer.name !== "string" ||
      !expectedKeys.has(answer.name) ||
      byName.has(answer.name)
    ) {
      return fail("OpenAI answers do not match the requested questions.");
    }
    byName.set(answer.name, answer);
  }
  if (byName.size !== expectedKeys.size) {
    return fail("OpenAI answers do not match the requested questions.");
  }
  const refused = compiled.filter(({ keys }) =>
    keys.some((key) => byName.get(key)!.type === "refusal"),
  );
  if (refused.length > 0) {
    throw new DecisionRefusalError({
      provider: "OpenAI",
      modelId,
      questionNames: refused.map(({ name }) => name),
      rawResponse,
    });
  }
  const answers = Object.fromEntries(
    compiled.map(({ name, question, keys }) => {
      const getAnswer = (key: string | undefined) => byName.get(key!)!;
      const predicate = (key: string | undefined): number => {
        const answer = getAnswer(key);
        if (answer.type !== "predicate" || !isProbability(answer.probability)) {
          return fail("OpenAI returned an invalid predicate probability.", name);
        }
        return answer.probability;
      };
      if (question.type === "check") {
        return [name, { type: "check", probability: predicate(keys[0]) }];
      }
      if (question.type === "multi-label") {
        const labels = Object.keys(question.options);
        const probabilities = Object.fromEntries(
          labels.map((label, index) => [label, predicate(keys[index])]),
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
      if (
        answer.type !== question.type ||
        !isProbability(answer.confidence) ||
        !Array.isArray(answer.probabilities)
      ) {
        return fail("OpenAI returned an invalid choice or score answer.", name);
      }
      const distribution = answer.probabilities;
      if (question.type === "choice") {
        const labels = Object.keys(question.options);
        const probabilities = new Map<string, number>();
        for (const entry of distribution) {
          if (
            !isDataObject(entry) ||
            typeof entry.value !== "string" ||
            !Object.hasOwn(question.options, entry.value) ||
            probabilities.has(entry.value) ||
            !isProbability(entry.probability)
          ) {
            return fail("OpenAI returned invalid choice probabilities.", name);
          }
          probabilities.set(entry.value, entry.probability);
        }
        if (
          probabilities.size !== labels.length ||
          !sumsToOne([...probabilities.values()]) ||
          typeof answer.choice !== "string" ||
          !Object.hasOwn(question.options, answer.choice)
        ) {
          return fail("OpenAI returned an invalid choice answer.", name);
        }
        return [
          name,
          {
            type: "choice",
            choice: answer.choice,
            confidence: answer.confidence,
            probabilities: Object.fromEntries(
              labels.map((label) => [label, probabilities.get(label)!]),
            ),
          },
        ];
      }
      const probabilities = new Map<number, number>();
      for (const entry of distribution) {
        if (
          !isDataObject(entry) ||
          typeof entry.value !== "number" ||
          !Number.isSafeInteger(entry.value) ||
          entry.value < 0 ||
          entry.value >= question.rubric.length ||
          entry.label !== String(entry.value) ||
          probabilities.has(entry.value) ||
          !isProbability(entry.probability)
        ) {
          return fail("OpenAI returned invalid score probabilities or rubric labels.", name);
        }
        probabilities.set(entry.value, entry.probability);
      }
      if (
        probabilities.size !== question.rubric.length ||
        !sumsToOne([...probabilities.values()]) ||
        typeof answer.score !== "number" ||
        !Number.isFinite(answer.score) ||
        answer.score < 0 ||
        answer.score > question.rubric.length - 1
      ) {
        return fail("OpenAI returned an invalid score answer.", name);
      }
      return [
        name,
        {
          type: "score",
          score: answer.score,
          confidence: answer.confidence,
          rubric: question.rubric,
          probabilities: question.rubric.map((_, index) => probabilities.get(index)!),
        },
      ];
    }),
  ) as DecisionAnswers<Questions>;
  const usage = rawResponse.usage;
  if (
    !isDataObject(usage) ||
    !isTokenCount(usage.input_tokens) ||
    !isTokenCount(usage.output_tokens) ||
    !isTokenCount(usage.total_tokens) ||
    usage.total_tokens !== usage.input_tokens + usage.output_tokens ||
    !isDataObject(usage.input_tokens_details) ||
    !isDataObject(usage.output_tokens_details)
  ) {
    return fail("OpenAI returned invalid decision token usage.");
  }
  const cached = usage.input_tokens_details.cached_tokens;
  const written = usage.input_tokens_details.cache_write_tokens;
  const reasoning = usage.output_tokens_details.reasoning_tokens;
  if (
    !isTokenCount(cached) ||
    !isTokenCount(written) ||
    !isTokenCount(reasoning) ||
    cached + written > usage.input_tokens ||
    reasoning > usage.output_tokens
  ) {
    return fail("OpenAI returned invalid decision token usage details.");
  }
  const normalizedUsage = normalizeOpenAIUsage({
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cachedInputTokens: cached,
    reasoningOutputTokens: reasoning,
  });
  return {
    answers,
    usage: { ...normalizedUsage, cacheCreationInputTokens: written },
    rawResponse,
  };
}

function isDataObject(value: unknown): value is Record<string, JsonValue> {
  return isPlainObject(value) && isJsonValue(value);
}
function isProbability(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}
function isTokenCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function sumsToOne(values: number[]): boolean {
  return Math.abs(values.reduce((sum, value) => sum + value, 0) - 1) <= 1e-5;
}
