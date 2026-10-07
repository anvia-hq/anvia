import { isJsonValue } from "../completion/json";
import { DecisionCapabilityError } from "./errors";
import type { DecisionModel, DecisionQuestion, DecisionRequest } from "./types";

export function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Reflect.ownKeys(value).every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return typeof key === "string" && descriptor?.enumerable === true && "value" in descriptor;
  });
}

export function assertQuestion(value: unknown): asserts value is DecisionQuestion {
  if (!isRecord(value)) throw new TypeError("Decision questions must be plain data objects.");
  if (typeof value.instructions !== "string" || value.instructions.trim().length === 0) {
    throw new TypeError("Decision instructions must be a non-empty string.");
  }
  switch (value.type) {
    case "choice":
    case "multi-label":
      if (
        !isRecord(value.options) ||
        !isJsonValue(value.options) ||
        Object.keys(value.options).length === 0 ||
        Object.keys(value.options).some((key) => key.trim().length === 0)
      ) {
        throw new TypeError("Decision options must contain non-empty labels with JSON criteria.");
      }
      if (value.type === "multi-label" && value.threshold !== undefined) {
        if (!isProbability(value.threshold)) {
          throw new RangeError("Multi-label threshold must be between zero and one.");
        }
      }
      break;
    case "score":
      if (!Array.isArray(value.rubric) || value.rubric.length < 2 || !isJsonValue(value.rubric)) {
        throw new TypeError("Decision rubric must contain at least two JSON levels.");
      }
      break;
    case "check":
      break;
    default:
      throw new TypeError("Unknown decision question type.");
  }
}

export function assertRequest(request: DecisionRequest, model: DecisionModel): void {
  if (!isJsonValue(request.state)) throw new TypeError("Decision state must be JSON-compatible.");
  if (!isRecord(request.questions) || Object.keys(request.questions).length === 0) {
    throw new TypeError("Decision questions must be a non-empty plain data object.");
  }
  if (
    request.providerOptions !== undefined &&
    (!isRecord(request.providerOptions) || !isJsonValue(request.providerOptions))
  ) {
    throw new TypeError("Decision providerOptions must be a JSON object.");
  }
  const kinds = new Set<string>();
  for (const [name, question] of Object.entries(request.questions)) {
    if (name.trim().length === 0) throw new TypeError("Decision question names must be non-empty.");
    assertQuestion(question);
    const support = model.capabilities.questionSupport[question.type];
    if (support !== "native" && support !== "composed") {
      throw new DecisionCapabilityError({
        provider: model.provider,
        modelId: model.modelId,
        questionType: question.type,
      });
    }
    kinds.add(question.type);
    const limits = model.capabilities.limits;
    if (question.type === "choice") {
      assertLimit(Object.keys(question.options).length, limits?.maxChoiceOptions, "choice options");
    } else if (question.type === "multi-label") {
      assertLimit(Object.keys(question.options).length, limits?.maxMultiLabelOptions, "labels");
    } else if (question.type === "score") {
      assertLimit(question.rubric.length, limits?.maxRubricLevels, "rubric levels");
    }
  }
  if (kinds.size > 1 && !model.capabilities.mixedQuestions) {
    throw new TypeError(`${model.provider}/${model.modelId} does not support mixed questions.`);
  }
  assertLimit(
    Object.keys(request.questions).length,
    model.capabilities.limits?.maxQuestionsPerRequest,
    "questions",
  );
}

export function isProbability(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function assertLimit(count: number, limit: number | undefined, name: string): void {
  if (limit !== undefined && count > limit) {
    throw new RangeError(`Decision request exceeds the model limit of ${limit} ${name}.`);
  }
}
