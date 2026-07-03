import type {
  ToolApproval,
  ToolQuestion,
  UIMessage,
  UseChatResult,
  UseCompletionResult,
} from "@anvia/react";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  ChatProvider,
  Completion,
  CompletionProvider,
  Composer,
  HumanInput,
  Message,
  Thread,
} from "../src";

describe("@anvia/react-ui primitives", () => {
  it("throws when chat primitives are rendered outside ChatProvider", () => {
    expect(() => render(<Thread.Root />)).toThrow(
      "Anvia chat primitives must be used inside ChatProvider.",
    );
  });

  it("renders chat messages and all supported message part kinds", () => {
    const messages: UIMessage[] = [
      {
        id: "assistant_1",
        role: "assistant",
        parts: [
          { id: "text_1", type: "text", text: "Hello" },
          { id: "reasoning_1", type: "reasoning", text: "Thinking" },
          {
            id: "tool_1",
            type: "tool",
            toolName: "search",
            toolCallId: "call_1",
            state: "output-available",
            input: { query: "anvia" },
            output: { ok: true },
          },
          { id: "data_1", type: "data", name: "result", data: { count: 2 } },
          { id: "error_1", type: "error", error: { message: "Nope" } },
        ],
      },
    ];

    render(
      <ChatProvider controller={createChatController({ messages })}>
        <Thread.Root>
          <Thread.Messages>
            <Message.Root>
              <Message.Content>
                <Message.Parts />
              </Message.Content>
            </Message.Root>
          </Thread.Messages>
        </Thread.Root>
      </ChatProvider>,
    );

    expect(screen.getByText("Hello")).toBeTruthy();
    expect(screen.getByText("Thinking")).toBeTruthy();
    expect(screen.getByText("search")).toBeTruthy();
    expect(screen.getByText(/"query": "anvia"/)).toBeTruthy();
    expect(screen.getByText(/"count": 2/)).toBeTruthy();
    expect(screen.getByText("Nope")).toBeTruthy();
  });

  it("supports custom tool rendering with input and output in one component", () => {
    const messages: UIMessage[] = [
      {
        id: "assistant_1",
        role: "assistant",
        parts: [
          {
            id: "tool_1",
            type: "tool",
            toolName: "get_order",
            toolCallId: "call_1",
            state: "output-available",
            input: { id: "A-100" },
            output: { status: "blocked" },
          },
        ],
      },
    ];

    render(
      <ChatProvider controller={createChatController({ messages })}>
        <Thread.Root>
          <Thread.Messages>
            <Message.Root>
              <Message.Content>
                <Message.Parts>
                  {(part) =>
                    part.type === "tool" ? (
                      <Message.Part>
                        <Message.Tool>
                          {(tool) => (
                            <section data-testid="tool-card">
                              <h2>{tool.toolName}</h2>
                              <div>Input: {JSON.stringify(tool.input)}</div>
                              <div>Output: {JSON.stringify(tool.output)}</div>
                            </section>
                          )}
                        </Message.Tool>
                      </Message.Part>
                    ) : (
                      <Message.Part />
                    )
                  }
                </Message.Parts>
              </Message.Content>
            </Message.Root>
          </Thread.Messages>
        </Thread.Root>
      </ChatProvider>,
    );

    expect(screen.getAllByTestId("tool-card")).toHaveLength(1);
    expect(screen.getByText("get_order")).toBeTruthy();
    expect(screen.getByText('Input: {"id":"A-100"}')).toBeTruthy();
    expect(screen.getByText('Output: {"status":"blocked"}')).toBeTruthy();
  });

  it("filters message parts and gates tool rendering by state", () => {
    const messages: UIMessage[] = [
      {
        id: "assistant_1",
        role: "assistant",
        parts: [
          {
            id: "tool_pending",
            type: "tool",
            toolName: "pending_lookup",
            toolCallId: "call_pending",
            state: "input-available",
            input: { id: "A-100" },
          },
          {
            id: "tool_done",
            type: "tool",
            toolName: "done_lookup",
            toolCallId: "call_done",
            state: "output-available",
            input: { id: "B-200" },
            output: { status: "shipped" },
          },
        ],
      },
    ];

    render(
      <ChatProvider controller={createChatController({ messages })}>
        <Thread.Root>
          <Thread.Messages>
            <Message.Root>
              <Message.Content>
                <Message.Parts
                  filter={(part) => part.type !== "tool" || part.state === "output-available"}
                >
                  {(part) =>
                    part.type === "tool" ? (
                      <Message.Part>
                        <Message.Tool renderWhen="settled">
                          {(tool) => <span data-testid="settled-tool">{tool.toolName}</span>}
                        </Message.Tool>
                      </Message.Part>
                    ) : (
                      <Message.Part />
                    )
                  }
                </Message.Parts>
              </Message.Content>
            </Message.Root>
          </Thread.Messages>
        </Thread.Root>
      </ChatProvider>,
    );

    expect(screen.queryByText("pending_lookup")).toBeNull();
    expect(screen.getByText("done_lookup")).toBeTruthy();
    expect(screen.getAllByTestId("settled-tool")).toHaveLength(1);
  });

  it("submits chat composer input and supports asChild", () => {
    const sendMessage = vi.fn(async () => {});

    render(
      <ChatProvider controller={createChatController({ sendMessage })}>
        <Composer.Root aria-label="Chat form">
          <Composer.Input />
          <Composer.Submit asChild>
            <button data-testid="send" type="submit">
              Send
            </button>
          </Composer.Submit>
        </Composer.Root>
      </ChatProvider>,
    );

    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "hello" } });
    const button = screen.getByTestId("send");
    expect(button.getAttribute("data-anvia-submit")).toBe("");

    fireEvent.click(button);

    expect(sendMessage).toHaveBeenCalledWith("hello");
  });

  it("submits completion input and renders completion output", () => {
    const complete = vi.fn(async () => {});

    function Harness() {
      const [input, setInput] = useState("");
      return (
        <CompletionProvider
          controller={createCompletionController({
            completion: "Current answer",
            complete,
            input,
            setInput,
          })}
        >
          <Completion.Root>
            <Completion.Output />
            <Completion.Form aria-label="Completion form">
              <Completion.Input />
              <Completion.Submit />
            </Completion.Form>
          </Completion.Root>
        </CompletionProvider>
      );
    }

    render(<Harness />);

    expect(screen.getByText("Current answer")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Prompt"), { target: { value: "finish this" } });
    fireEvent.submit(screen.getByLabelText("Completion form"));

    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("approves and rejects pending tool approvals", () => {
    const approval: ToolApproval = {
      id: "approval_1",
      toolName: "deploy",
      status: "pending",
    };
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
    const question: ToolQuestion = {
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
      ],
      status: "pending",
    };
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

function createChatController(
  overrides: Partial<UseChatResult<unknown>> = {},
): UseChatResult<unknown> {
  return {
    messages: [],
    events: [],
    setMessages: vi.fn(),
    sendMessage: vi.fn(async () => {}),
    send: vi.fn(async () => {}),
    regenerate: vi.fn(async () => {}),
    stop: vi.fn(),
    reset: vi.fn(),
    status: "idle",
    error: undefined,
    text: "",
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

function createCompletionController(
  overrides: Partial<UseCompletionResult<unknown>> = {},
): UseCompletionResult<unknown> {
  return {
    messages: [],
    completion: "",
    input: "",
    setInput: vi.fn(),
    complete: vi.fn(async () => {}),
    stop: vi.fn(),
    reset: vi.fn(),
    status: "idle",
    error: undefined,
    events: [],
    ...overrides,
  };
}
