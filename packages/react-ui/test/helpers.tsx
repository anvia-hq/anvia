import type { ClientInteraction, UIMessage } from "@anvia/client";
import type {
  AgentToolApprovalRequest,
  AgentToolQuestionRequest,
} from "@anvia/core/agent/interactions";
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
    interactions: { all: [], pending: [] },
    respondingInteractions: new Set(),
    respondToInteraction: vi.fn(async () => {}),
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

export function pendingApproval(
  overrides: Partial<AgentToolApprovalRequest> = {},
): ClientInteraction & { request: AgentToolApprovalRequest } {
  return {
    request: {
      type: "tool-approval",
      id: "approval_1",
      toolName: "deploy",
      toolCallId: "call_1",
      internalCallId: "internal_1",
      input: {},
      ...overrides,
    },
    runId: "run_1",
    status: "pending",
  };
}

export function multiPromptQuestion(
  overrides: Partial<AgentToolQuestionRequest> = {},
): ClientInteraction & { request: AgentToolQuestionRequest } {
  return {
    request: {
      type: "tool-question",
      id: "question_1",
      toolName: "confirm",
      toolCallId: "call_1",
      internalCallId: "internal_1",
      questions: [
        {
          id: "confirm",
          text: "Continue?",
          choices: [
            { label: "Yes", value: "yes" },
            { label: "No", value: "no" },
          ],
        },
        {
          id: "region",
          text: "Region?",
          choices: [
            { label: "US", value: "us" },
            { label: "EU", value: "eu" },
          ],
        },
      ],
      ...overrides,
    },
    runId: "run_1",
    status: "pending",
  };
}
