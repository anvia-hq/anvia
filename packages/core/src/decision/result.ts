import { isJsonValue } from "../completion/json";
import type { JsonValue } from "../completion/types";
import { DecisionProviderOutputError } from "./errors";
import type { DecisionModel, DecisionQuestion, DecisionRequest } from "./types";
import { isProbability, isRecord } from "./validation";

/** Validate provider answers before callers use them to branch or act. */
export function assertResult(value: unknown, request: DecisionRequest, model: DecisionModel): void {
  function fail(message: string, questionName?: string): never {
    throw new DecisionProviderOutputError(message, {
      provider: model.provider,
      modelId: model.modelId,
      questionName,
    });
  }
  if (!isRecord(value) || !Object.hasOwn(value, "rawResponse")) {
    fail("Decision model returned an invalid result.");
  }
  const answers = value.answers;
  if (!isRecord(answers) || !sameKeys(answers, Object.keys(request.questions))) {
    fail("Decision answers must match the requested question names.");
  }
  for (const [name, question] of Object.entries(request.questions)) {
    const answer = answers[name];
    if (!isRecord(answer) || answer.type !== question.type) {
      fail("Decision answer has an invalid shape or type.", name);
    }
    if (answer.confidence !== undefined && !isProbability(answer.confidence)) {
      fail("Decision confidence must be between zero and one.", name);
    }
    if (!validAnswer(answer, question))
      fail("Decision answer violates its question contract.", name);
  }
  if (value.usage !== undefined && !validUsage(value.usage)) {
    fail("Decision model returned invalid token usage.");
  }
}

function validAnswer(answer: Record<string, unknown>, question: DecisionQuestion): boolean {
  switch (question.type) {
    case "choice": {
      const labels = Object.keys(question.options);
      return (
        typeof answer.choice === "string" &&
        Object.hasOwn(question.options, answer.choice) &&
        (answer.probabilities === undefined ||
          validDistribution(answer.probabilities, labels, true))
      );
    }
    case "multi-label": {
      const labels = Object.keys(question.options);
      if (
        !Array.isArray(answer.labels) ||
        !isJsonValue(answer.labels) ||
        new Set(answer.labels).size !== answer.labels.length ||
        !validDistribution(answer.probabilities, labels, false)
      )
        return false;
      const probabilities = answer.probabilities as Record<string, number>;
      const selected = labels.filter(
        (label) => probabilities[label]! >= (question.threshold ?? 0.5),
      );
      return (
        answer.labels.length === selected.length &&
        answer.labels.every((label) => typeof label === "string" && selected.includes(label))
      );
    }
    case "score":
      return (
        typeof answer.score === "number" &&
        Number.isFinite(answer.score) &&
        answer.score >= 0 &&
        answer.score <= question.rubric.length - 1 &&
        isJsonValue(answer.rubric) &&
        jsonEqual(answer.rubric, question.rubric) &&
        (answer.probabilities === undefined ||
          (Array.isArray(answer.probabilities) &&
            isJsonValue(answer.probabilities) &&
            answer.probabilities.length === question.rubric.length &&
            answer.probabilities.every(isProbability) &&
            sumsToOne(answer.probabilities)))
      );
    case "check":
      return isProbability(answer.probability);
  }
}

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
  if (!isRecord(left) || !isRecord(right)) return false;
  const keys = Object.keys(left);
  return sameKeys(right, keys) && keys.every((key) => jsonEqual(left[key]!, right[key]!));
}

function validDistribution(value: unknown, labels: string[], exclusive: boolean): boolean {
  if (!isRecord(value) || !sameKeys(value, labels)) return false;
  const probabilities = Object.values(value);
  return probabilities.every(isProbability) && (!exclusive || sumsToOne(probabilities));
}

function sumsToOne(values: number[]): boolean {
  // Permit ordinary rounding in provider probability distributions.
  return Math.abs(values.reduce((sum, probability) => sum + probability, 0) - 1) <= 1e-5;
}

function sameKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return (
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
  );
}

function validUsage(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const fields = [
    "inputTokens",
    "outputTokens",
    "totalTokens",
    "cachedInputTokens",
    "cacheCreationInputTokens",
  ];
  return (
    fields.every(
      (key) => typeof value[key] === "number" && Number.isFinite(value[key]) && value[key] >= 0,
    ) &&
    (value.details === undefined ||
      (isRecord(value.details) &&
        Object.values(value.details).every(
          (count) => typeof count === "number" && Number.isFinite(count) && count >= 0,
        )))
  );
}
