import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChatProvider, HumanInput } from "../src";
import { createChatController, multiPromptQuestion, pendingApproval } from "./helpers";

afterEach(() => {
  cleanup();
});

describe("HumanInput primitives", () => {
  it("approves and rejects pending tool approvals", () => {
    const approval = pendingApproval();
    const approveTool = vi.fn(async () => {});
    const rejectTool = vi.fn(async () => {});

    render(
      <ChatProvider
        controller={createChatController({
          approveTool,
          rejectTool,
          humanInput: {
            approvals: { all: [approval], pending: [approval] },
            questions: { all: [], pending: [] },
          },
        })}
      >
        <HumanInput.Approvals />
      </ChatProvider>,
    );

    fireEvent.click(screen.getByText("Approve"));
    fireEvent.click(screen.getByText("Reject"));

    expect(approveTool).toHaveBeenCalledWith("approval_1");
    expect(rejectTool).toHaveBeenCalledWith("approval_1");
  });

  it("passes approval reasons and renders panel status", () => {
    const approval = pendingApproval();
    const approveTool = vi.fn(async () => {});

    render(
      <ChatProvider
        controller={createChatController({
          approveTool,
          humanInput: {
            approvals: { all: [approval], pending: [approval] },
            questions: { all: [], pending: [] },
          },
        })}
      >
        <HumanInput.Panel>
          <HumanInput.Status />
          <HumanInput.Approvals />
        </HumanInput.Panel>
      </ChatProvider>,
    );

    expect(screen.getByText("1 pending")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Approval reason"), {
      target: { value: "looks safe" },
    });
    fireEvent.click(screen.getByText("Approve"));

    expect(approveTool).toHaveBeenCalledWith("approval_1", "looks safe");
  });

  it("answers pending tool questions from selected choices", () => {
    const question = multiPromptQuestion({
      questions: [
        {
          id: "confirm",
          question: "Continue?",
          choices: [
            { label: "Yes", value: "yes" },
            { label: "No", value: "no" },
          ],
        },
      ],
    });
    const answerToolQuestion = vi.fn(async () => {});

    render(
      <ChatProvider
        controller={createChatController({
          answerToolQuestion,
          humanInput: {
            approvals: { all: [], pending: [] },
            questions: { all: [question], pending: [question] },
          },
        })}
      >
        <HumanInput.Questions />
      </ChatProvider>,
    );

    fireEvent.click(screen.getByText("Yes"));
    fireEvent.click(screen.getByText("Submit"));

    expect(answerToolQuestion).toHaveBeenCalledWith("question_1", [
      { questionId: "confirm", answer: "Yes", choice: "yes" },
    ]);
  });

  it("answers pending tool questions from text prompts", () => {
    const question = multiPromptQuestion({
      questions: [
        {
          id: "details",
          question: "What changed?",
          choices: [],
        },
      ],
    });
    const answerToolQuestion = vi.fn(async () => {});

    render(
      <ChatProvider
        controller={createChatController({
          answerToolQuestion,
          humanInput: {
            approvals: { all: [], pending: [] },
            questions: { all: [question], pending: [question] },
          },
        })}
      >
        <HumanInput.Questions />
      </ChatProvider>,
    );

    fireEvent.change(screen.getByLabelText("What changed?"), {
      target: { value: "Updated the config" },
    });
    fireEvent.click(screen.getByText("Submit"));

    expect(answerToolQuestion).toHaveBeenCalledWith("question_1", [
      { questionId: "details", answer: "Updated the config", custom: true },
    ]);
  });
});
