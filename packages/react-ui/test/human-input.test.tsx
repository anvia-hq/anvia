import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChatProvider, HumanInputPrimitive as HumanInput } from "../src";
import { createChatController, multiPromptQuestion, pendingApproval } from "./helpers";

afterEach(() => {
  cleanup();
});

describe("HumanInput primitives", () => {
  it("unmounts empty lists by default and keeps them mounted when requested", () => {
    render(
      <ChatProvider controller={createChatController()}>
        <HumanInput.Approvals data-testid="approvals" />
        <HumanInput.Approvals data-testid="approvals-mounted" keepMounted />
        <HumanInput.Questions data-testid="questions" />
        <HumanInput.Questions data-testid="questions-mounted" keepMounted />
      </ChatProvider>,
    );

    expect(screen.queryByTestId("approvals")).toBeNull();
    expect(screen.queryByTestId("questions")).toBeNull();
    expect(screen.getByTestId("approvals-mounted").getAttribute("data-state")).toBe("empty");
    expect(screen.getByTestId("questions-mounted").getAttribute("data-state")).toBe("empty");
  });

  it("approves and rejects pending tool approvals", () => {
    const approval = pendingApproval();
    const respondToInteraction = vi.fn(async () => {});

    render(
      <ChatProvider
        controller={createChatController({
          respondToInteraction,
          interactions: { all: [approval], pending: [approval] },
        })}
      >
        <HumanInput.Approvals />
      </ChatProvider>,
    );

    fireEvent.click(screen.getByText("Approve"));
    fireEvent.click(screen.getByText("Reject"));

    expect(respondToInteraction).toHaveBeenNthCalledWith(1, {
      interactionId: "approval_1",
      response: { type: "tool-approval", approved: true },
    });
    expect(respondToInteraction).toHaveBeenNthCalledWith(2, {
      interactionId: "approval_1",
      response: { type: "tool-approval", approved: false },
    });
  });

  it("passes approval reasons and renders panel status", () => {
    const approval = pendingApproval();
    const respondToInteraction = vi.fn(async () => {});

    render(
      <ChatProvider
        controller={createChatController({
          respondToInteraction,
          interactions: { all: [approval], pending: [approval] },
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

    expect(respondToInteraction).toHaveBeenCalledWith({
      interactionId: "approval_1",
      response: { type: "tool-approval", approved: true, reason: "looks safe" },
    });
  });

  it("answers pending tool questions from selected choices", () => {
    const question = multiPromptQuestion({
      questions: [
        {
          id: "confirm",
          text: "Continue?",
          choices: [
            { label: "Yes", value: "yes" },
            { label: "No", value: "no" },
          ],
        },
      ],
    });
    const respondToInteraction = vi.fn(async () => {});

    render(
      <ChatProvider
        controller={createChatController({
          respondToInteraction,
          interactions: { all: [question], pending: [question] },
        })}
      >
        <HumanInput.Questions />
      </ChatProvider>,
    );

    fireEvent.click(screen.getByText("Yes"));
    fireEvent.click(screen.getByText("Submit"));

    expect(respondToInteraction).toHaveBeenCalledWith({
      interactionId: "question_1",
      response: {
        type: "tool-question",
        answers: [{ questionId: "confirm", value: "yes" }],
      },
    });
  });

  it("answers pending tool questions from text prompts", () => {
    const question = multiPromptQuestion({
      questions: [
        {
          id: "details",
          text: "What changed?",
        },
      ],
    });
    const respondToInteraction = vi.fn(async () => {});

    render(
      <ChatProvider
        controller={createChatController({
          respondToInteraction,
          interactions: { all: [question], pending: [question] },
        })}
      >
        <HumanInput.Questions />
      </ChatProvider>,
    );

    fireEvent.change(screen.getByLabelText("What changed?"), {
      target: { value: "Updated the config" },
    });
    fireEvent.click(screen.getByText("Submit"));

    expect(respondToInteraction).toHaveBeenCalledWith({
      interactionId: "question_1",
      response: {
        type: "tool-question",
        answers: [{ questionId: "details", value: "Updated the config" }],
      },
    });
  });
});
