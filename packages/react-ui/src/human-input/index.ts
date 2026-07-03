import {
  HumanInputApproval,
  HumanInputApprovalReason,
  HumanInputApprovals,
  HumanInputApprove,
  HumanInputReject,
  HumanInputStatus,
} from "./approvals";
import { HumanInputPanel } from "./panel";
import {
  HumanInputQuestion,
  HumanInputQuestionChoice,
  HumanInputQuestionPrompt,
  HumanInputQuestionSubmit,
  HumanInputQuestions,
  HumanInputQuestionTextAnswer,
} from "./questions";

export const HumanInput = {
  Panel: HumanInputPanel,
  Status: HumanInputStatus,
  Approvals: HumanInputApprovals,
  Approval: HumanInputApproval,
  ApprovalReason: HumanInputApprovalReason,
  Approve: HumanInputApprove,
  Reject: HumanInputReject,
  Questions: HumanInputQuestions,
  Question: HumanInputQuestion,
  QuestionPrompt: HumanInputQuestionPrompt,
  QuestionChoice: HumanInputQuestionChoice,
  QuestionTextAnswer: HumanInputQuestionTextAnswer,
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
