import type { DecisionQuestion, DecisionQuestions, JsonValue } from "@anvia/core/decision";
import type { DecisionCreateParams } from "openai/resources/decisions";

type WireQuestion = DecisionCreateParams["questions"][number];

export type CompiledDecisionQuestion = {
  name: string;
  question: DecisionQuestion;
  keys: string[];
};

export function compileDecisionQuestions(questions: DecisionQuestions): {
  compiled: CompiledDecisionQuestion[];
  wireQuestions: WireQuestion[];
} {
  const compiled: CompiledDecisionQuestion[] = [];
  const wireQuestions: WireQuestion[] = [];
  for (const [index, [name, question]] of Object.entries(questions).entries()) {
    const key = `q${index}`;
    if (question.type === "multi-label") {
      const keys = Object.entries(question.options).map(([label, criteria], labelIndex) => {
        const labelKey = `${key}_${labelIndex}`;
        wireQuestions.push({
          type: "predicate",
          name: labelKey,
          instructions: JSON.stringify({
            task: "Does this label apply to the input? Evaluate it independently of other labels.",
            instructions: question.instructions,
            label,
            criteria,
          }),
        });
        return labelKey;
      });
      compiled.push({ name, question, keys });
    } else {
      wireQuestions.push(nativeQuestion(key, question));
      compiled.push({ name, question, keys: [key] });
    }
  }
  return { compiled, wireQuestions };
}

function nativeQuestion(
  name: string,
  question: Exclude<DecisionQuestion, { type: "multi-label" }>,
): WireQuestion {
  switch (question.type) {
    case "check":
      return { type: "predicate", name, instructions: question.instructions };
    case "choice": {
      const choices = Object.entries(question.options).map(([value, description]) => ({
        value,
        ...(description === null ? {} : { description: decisionText(description) }),
      }));
      if (choices.length < 2) {
        throw new RangeError("OpenAI choice questions require at least two options.");
      }
      return { type: "choice", name, instructions: question.instructions, choices };
    }
    case "score":
      return {
        type: "score",
        name,
        instructions: question.instructions,
        levels: question.rubric.map((description, index) => ({
          label: String(index),
          ...(description === null ? {} : { description: decisionText(description) }),
        })),
      };
  }
}

/** Preserve text verbatim and encode other JSON evidence or criteria as text. */
export function decisionText(value: JsonValue): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}
