import type { DecisionQuestion, DecisionQuestions, JsonValue } from "@anvia/core/decision";
import type { EntryType, JsonValue as SdkJsonValue, Question } from "@typesafe-ai/sdk";

export type CompiledJevQuestion = {
  name: string;
  question: DecisionQuestion;
  keys: string[];
};

export function compileJevQuestions(questions: DecisionQuestions): {
  compiled: CompiledJevQuestion[];
  wireQuestions: [string, Question][];
} {
  const compiled: CompiledJevQuestion[] = [];
  const wireQuestions: [string, Question][] = [];
  for (const [index, [name, question]] of Object.entries(questions).entries()) {
    const key = `q${index}`;

    if (question.type === "multi-label") {
      const keys = Object.entries(question.options).map(([label, description], labelIndex) => {
        const labelKey = `${key}_${labelIndex}`;
        wireQuestions.push([
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
      wireQuestions.push([key, native]);
      compiled.push({ name, question, keys: [key] });
    }
  }
  return { compiled, wireQuestions };
}

/** The SDK accepts text, objects, arrays, and null; preserve scalar JSON inside an object. */
export function toEntry(value: JsonValue): EntryType {
  const normalized = sdkJson(value);
  return typeof normalized === "number" || typeof normalized === "boolean"
    ? { value: normalized }
    : normalized;
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

function sdkJson(value: JsonValue): SdkJsonValue {
  if (Array.isArray(value)) return value.map(sdkJson);

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, sdkJson(entry)]));
  }

  return value as string | number | boolean | null;
}
