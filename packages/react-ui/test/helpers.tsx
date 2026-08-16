import type { ToolApproval, ToolQuestion, UIMessage } from "@anvia/client";
import type { UseChatResult, UseCompletionResult } from "@anvia/react";
import { vi } from "vitest";

export function textMessage(id: string, role: UIMessage["role"], text: string): UIMessage {
  return {
    id,
    role,
    parts: [{ id: `${id}_text`, type: "text", text }],
  };
}

export function createChatController(overrides: Partial<UseChatResult> = {}): UseChatResult {
  return {
    messages: [],
    events: [],
    contextUsage: undefined,
    suggestions: [],
    setMessages: vi.fn(),
    sendMessage: vi.fn(async () => {}),
    regenerate: vi.fn(async () => {}),
    stop: vi.fn(),
    reset: vi.fn(),
    status: "ready",
    error: undefined,
    text: "",
    streamId: undefined,
    isResuming: false,
    resume: vi.fn(async () => {}),
    humanInput: {
      approvals: { all: [], pending: [] },
      questions: { all: [], pending: [] },
    },
    decidingApprovals: new Set(),
    answeringQuestions: new Set(),
    approveTool: vi.fn(async () => {}),
    rejectTool: vi.fn(async () => {}),
    answerToolQuestion: vi.fn(async () => {}),
    ...overrides,
  };
}

export function createCompletionController(
  overrides: Partial<UseCompletionResult> = {},
): UseCompletionResult {
  return {
    completion: "",
    input: "",
    setInput: vi.fn(),
    complete: vi.fn(async () => {}),
    submit: vi.fn(async () => {}),
    stop: vi.fn(),
    reset: vi.fn(),
    status: "ready",
    error: undefined,
    events: [],
    contextUsage: undefined,
    ...overrides,
  };
}

export function pendingApproval(overrides: Partial<ToolApproval> = {}): ToolApproval {
  return {
    id: "approval_1",
    toolName: "deploy",
    status: "pending",
    ...overrides,
  };
}

export function multiPromptQuestion(overrides: Partial<ToolQuestion> = {}): ToolQuestion {
  return {
    id: "question_1",
    toolName: "confirm",
    questions: [
      {
        id: "confirm",
        question: "Continue?",
        choices: [
          { label: "Yes", value: "yes" },
          { label: "No", value: "no" },
        ],
      },
      {
        id: "region",
        question: "Region?",
        choices: [
          { label: "US", value: "us" },
          { label: "EU", value: "eu" },
        ],
      },
    ],
    status: "pending",
    ...overrides,
  };
}
