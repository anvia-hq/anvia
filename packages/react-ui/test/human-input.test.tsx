import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ChatProvider, HumanInput } from "../src";
import { createChatController, multiPromptQuestion, pendingApproval } from "./helpers";

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
});
