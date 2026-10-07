import type {
  CheckQuestion,
  ChoiceQuestion,
  DecisionOptions,
  DecisionRubric,
  MultiLabelQuestion,
  ScoreQuestion,
} from "./types";
import { assertQuestion } from "./validation";

export function choice<const Options extends DecisionOptions>(
  options: Omit<ChoiceQuestion<Options>, "type">,
): ChoiceQuestion<Options> {
  const question: ChoiceQuestion<Options> = { ...options, type: "choice" };
  assertQuestion(question);
  return question;
}

export function multiLabel<const Options extends DecisionOptions>(
  options: Omit<MultiLabelQuestion<Options>, "type">,
): MultiLabelQuestion<Options> {
  const question: MultiLabelQuestion<Options> = { ...options, type: "multi-label" };
  assertQuestion(question);
  return question;
}

export function score<const Rubric extends DecisionRubric>(
  options: Omit<ScoreQuestion<Rubric>, "type">,
): ScoreQuestion<Rubric> {
  const question: ScoreQuestion<Rubric> = { ...options, type: "score" };
  assertQuestion(question);
  return question;
}

export function check(options: Omit<CheckQuestion, "type">): CheckQuestion {
  const question: CheckQuestion = { ...options, type: "check" };
  assertQuestion(question);
  return question;
}
