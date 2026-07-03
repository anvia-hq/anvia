import type {
  ToolApproval,
  ToolQuestion,
  ToolQuestionAnswer,
  ToolQuestionPrompt,
} from "@anvia/react";
import { createContext, createElement, type ReactElement, type ReactNode, useContext } from "react";

export type ApprovalContextValue = {
  approval: ToolApproval;
};

export type QuestionContextValue = {
  question: ToolQuestion;
  answers: Record<string, ToolQuestionAnswer>;
  setAnswer(prompt: ToolQuestionPrompt, answer: ToolQuestionAnswer): void;
};

export type QuestionPromptContextValue = {
  prompt: ToolQuestionPrompt;
};

const ApprovalContext = createContext<ApprovalContextValue | undefined>(undefined);
const QuestionContext = createContext<QuestionContextValue | undefined>(undefined);
const QuestionPromptContext = createContext<QuestionPromptContextValue | undefined>(undefined);

export function InternalApprovalProvider({
  approval,
  children,
}: {
  approval: ToolApproval;
  children?: ReactNode;
}): ReactElement {
  return createElement(ApprovalContext.Provider, { value: { approval } }, children);
}

export function InternalQuestionProvider({
  value,
  children,
}: {
  value: QuestionContextValue;
  children?: ReactNode;
}): ReactElement {
  return createElement(QuestionContext.Provider, { value }, children);
}

export function InternalQuestionPromptProvider({
  prompt,
  children,
}: {
  prompt: ToolQuestionPrompt;
  children?: ReactNode;
}): ReactElement {
  return createElement(QuestionPromptContext.Provider, { value: { prompt } }, children);
}

export function useApproval(): ApprovalContextValue {
  const value = useContext(ApprovalContext);
  if (value === undefined) {
    throw new Error("Approval primitives must be used inside HumanInput.Approval.");
  }
  return value;
}

export function useQuestion(): QuestionContextValue {
  const value = useContext(QuestionContext);
  if (value === undefined) {
    throw new Error("Question primitives must be used inside HumanInput.Question.");
  }
  return value;
}

export function useQuestionPrompt(): QuestionPromptContextValue {
  const value = useContext(QuestionPromptContext);
  if (value === undefined) {
    throw new Error("Question choice primitives must be used inside HumanInput.QuestionPrompt.");
  }
  return value;
}
