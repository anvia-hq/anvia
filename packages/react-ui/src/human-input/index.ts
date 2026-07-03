import {
  HumanInputApproval,
  HumanInputApprovals,
  HumanInputApprove,
  HumanInputReject,
} from "./approvals";
import {
  HumanInputQuestion,
  HumanInputQuestionChoice,
  HumanInputQuestionPrompt,
  HumanInputQuestionSubmit,
  HumanInputQuestions,
} from "./questions";

export const HumanInput = {
  Approvals: HumanInputApprovals,
  Approval: HumanInputApproval,
  Approve: HumanInputApprove,
  Reject: HumanInputReject,
  Questions: HumanInputQuestions,
  Question: HumanInputQuestion,
  QuestionPrompt: HumanInputQuestionPrompt,
  QuestionChoice: HumanInputQuestionChoice,
  QuestionSubmit: HumanInputQuestionSubmit,
} as const;

export type {
  ApprovalContextValue,
  QuestionContextValue,
  QuestionPromptContextValue,
} from "../contexts";
export {
  useApproval,
  useChatContext,
  useHumanInput,
  useQuestion,
  useQuestionPrompt,
} from "../contexts";
