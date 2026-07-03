# React UI Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor `@anvia/react-ui` into focused modules, harden message and human-input behavior, export component prop types, and make the package coverage command pass.

**Architecture:** Preserve the published top-level files as public barrels while moving implementation into focused `chat`, `completion`, `human-input`, `message`, and `shared` folders. Add behavior tests before production changes, then perform structure-only moves under the expanded test suite.

**Tech Stack:** TypeScript, React 18+ primitives, Radix Slot, Vitest, Testing Library, happy-dom, tsup, Biome.

---

## Target File Structure

Create or modify these files:

```txt
packages/react-ui/src/
  chat.tsx                         public barrel
  chat/
    composer.tsx                   composer form/input/buttons
    index.ts                       chat namespace barrel
    thread.tsx                     thread root/viewport/messages/empty/scroll
  completion.tsx                   public barrel
  completion/
    index.tsx                      completion namespace implementation
  human-input.tsx                  public barrel
  human-input/
    approvals.tsx                  approval list/card/buttons
    index.ts                       human-input namespace barrel
    questions.tsx                  question provider/prompts/choices/submit
  index.ts                         package root barrel
  internal.tsx                     compatibility re-export from shared internals
  message.tsx                      public barrel
  message/
    actions.tsx                    copy/regenerate/actions primitives
    index.ts                       message namespace barrel
    parts.tsx                      message root/content/parts/renderers
  shared.ts                        public shared barrel
  shared/
    contexts.tsx                   providers and context hooks
    format.ts                      stringify and message text helpers
    index.ts                       shared public/internal barrel
    primitive.tsx                  PrimitiveProps, renderPrimitive, composeRefs
  styles.css                       scoped default stylesheet
packages/react-ui/test/
  chat.test.tsx                    chat/thread/composer behavior
  completion.test.tsx              completion behavior
  helpers.tsx                      controller and fixture helpers
  human-input.test.tsx             approval/question behavior
  message.test.tsx                 message parts/actions behavior
  public-api.test.tsx              public prop type and subpath smoke checks
packages/react-ui/test/react-ui.test.tsx remove after tests are split
apps/www/src/content/docs/packages/react-ui/reference.md public reference list
apps/www/src/content/docs/react-ui/reference.md product reference list
```

---

## Task 1: Create Shared Test Helpers and Split Existing Coverage

**Files:**
- Create: `packages/react-ui/test/helpers.tsx`
- Create: `packages/react-ui/test/message.test.tsx`
- Create: `packages/react-ui/test/chat.test.tsx`
- Create: `packages/react-ui/test/completion.test.tsx`
- Create: `packages/react-ui/test/human-input.test.tsx`
- Remove: `packages/react-ui/test/react-ui.test.tsx`

- [ ] **Step 1: Create test helpers**

Create `packages/react-ui/test/helpers.tsx`:

```tsx
import type {
  ToolApproval,
  ToolQuestion,
  UIMessage,
  UseChatResult,
  UseCompletionResult,
} from "@anvia/react";
import { vi } from "vitest";

export function textMessage(id: string, role: UIMessage["role"], text: string): UIMessage {
  return {
    id,
    role,
    parts: [{ id: `${id}_text`, type: "text", text }],
  };
}

export function createChatController(
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

export function createCompletionController(
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
```

- [ ] **Step 2: Move existing message tests**

Create `packages/react-ui/test/message.test.tsx` with the message-part tests from `react-ui.test.tsx`, importing helpers from `./helpers` instead of defining them inline. Keep these test names exactly:

```tsx
import type { UIMessage } from "@anvia/react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ChatProvider, Message, Thread } from "../src";
import { createChatController } from "./helpers";

describe("Message primitives", () => {
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
});
```

- [ ] **Step 3: Move existing chat test**

Create `packages/react-ui/test/chat.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ChatProvider, Composer, Thread } from "../src";
import { createChatController } from "./helpers";

describe("Chat primitives", () => {
  it("throws when chat primitives are rendered outside ChatProvider", () => {
    expect(() => render(<Thread.Root />)).toThrow(
      "Anvia chat primitives must be used inside ChatProvider.",
    );
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
});
```

- [ ] **Step 4: Move existing completion test**

Create `packages/react-ui/test/completion.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { Completion, CompletionProvider } from "../src";
import { createCompletionController } from "./helpers";

describe("Completion primitives", () => {
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
});
```

- [ ] **Step 5: Move existing human-input tests**

Create `packages/react-ui/test/human-input.test.tsx`:

```tsx
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
```

- [ ] **Step 6: Remove old combined test file**

Run:

```bash
rm packages/react-ui/test/react-ui.test.tsx
```

- [ ] **Step 7: Verify split tests pass**

Run:

```bash
pnpm --filter @anvia/react-ui test
```

Expected: all moved tests pass with zero failures.

- [ ] **Step 8: Commit test split**

```bash
git add packages/react-ui/test
git commit -m "test: split react ui primitive tests"
```

---

## Task 2: TDD Message Copy and Regenerate Behavior

**Files:**
- Modify: `packages/react-ui/test/message.test.tsx`
- Modify: `packages/react-ui/src/message.tsx`

- [ ] **Step 1: Add failing tests for copy state and latest-assistant regeneration**

Append these tests inside `describe("Message primitives", () => { ... })` in `packages/react-ui/test/message.test.tsx`:

```tsx
  it("sets copied state when clipboard write succeeds", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(
      <ChatProvider
        controller={createChatController({
          messages: [textMessage("assistant_1", "assistant", "Copy me")],
        })}
      >
        <Thread.Root>
          <Thread.Messages>
            <Message.Root>
              <Message.Copy />
            </Message.Root>
          </Thread.Messages>
        </Thread.Root>
      </ChatProvider>,
    );

    fireEvent.click(screen.getByText("Copy"));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("Copy me");
      expect(screen.getByText("Copy").getAttribute("data-state")).toBe("copied");
    });
  });

  it("sets error state when clipboard write fails", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn(async () => Promise.reject(new Error("denied"))) },
    });

    render(
      <ChatProvider
        controller={createChatController({
          messages: [textMessage("assistant_1", "assistant", "Copy me")],
        })}
      >
        <Thread.Root>
          <Thread.Messages>
            <Message.Root>
              <Message.Copy />
            </Message.Root>
          </Thread.Messages>
        </Thread.Root>
      </ChatProvider>,
    );

    fireEvent.click(screen.getByText("Copy"));

    await waitFor(() => {
      expect(screen.getByText("Copy").getAttribute("data-state")).toBe("error");
    });
  });

  it("enables regenerate only for the latest assistant message", () => {
    const regenerate = vi.fn(async () => {});
    const messages = [
      textMessage("user_1", "user", "First"),
      textMessage("assistant_1", "assistant", "Old answer"),
      textMessage("user_2", "user", "Second"),
      textMessage("assistant_2", "assistant", "Latest answer"),
    ];

    render(
      <ChatProvider controller={createChatController({ messages, regenerate })}>
        <Thread.Root>
          <Thread.Messages>
            {(message) => (
              <Message.Root>
                <Message.Regenerate>{`Regenerate ${message.id}`}</Message.Regenerate>
              </Message.Root>
            )}
          </Thread.Messages>
        </Thread.Root>
      </ChatProvider>,
    );

    expect((screen.getByText("Regenerate assistant_1") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText("Regenerate assistant_2") as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByText("Regenerate assistant_1"));
    fireEvent.click(screen.getByText("Regenerate assistant_2"));

    expect(regenerate).toHaveBeenCalledTimes(1);
  });
```

Add `textMessage` to the helper import at the top of `message.test.tsx`:

```tsx
import { createChatController, textMessage } from "./helpers";
```

- [ ] **Step 2: Verify tests fail for missing behavior**

Run:

```bash
pnpm --filter @anvia/react-ui test -- message.test.tsx
```

Expected: failures show `data-state` is not `error` for rejected clipboard and old assistant regenerate is not disabled.

- [ ] **Step 3: Implement message behavior**

In `packages/react-ui/src/message.tsx`, replace the `MessageCopy` component with:

```tsx
type MessageCopyState = "idle" | "copied" | "error";

const MessageCopy = forwardRef<HTMLButtonElement, PrimitiveProps<"button">>(function MessageCopy(
  { onClick, ...props },
  ref,
) {
  const { message } = useMessage();
  const [copyState, setCopyState] = useState<MessageCopyState>("idle");
  const text = messageText(message);
  const disabled = props.disabled ?? text.length === 0;

  const handleClick = useCallback(
    async (event: MouseEvent<HTMLButtonElement>) => {
      onClick?.(event);
      if (event.defaultPrevented || disabled) {
        return;
      }
      const writeText = navigator.clipboard?.writeText;
      if (writeText === undefined) {
        setCopyState("error");
        return;
      }
      try {
        await writeText.call(navigator.clipboard, text);
        setCopyState("copied");
      } catch {
        setCopyState("error");
      }
    },
    [disabled, onClick, text],
  );

  return renderPrimitive(
    "button",
    {
      ...props,
      children: props.children ?? "Copy",
      disabled,
      onClick: handleClick,
      type: props.type ?? "button",
      "data-anvia-copy": "",
      "data-state": copyState,
    } as PrimitiveProps<"button">,
    ref,
  );
});
```

In the `MessageRegenerate` component, replace the disabled calculation with:

```tsx
    const latestAssistantMessage = [...chat.messages]
      .reverse()
      .find((item) => item.role === "assistant");
    const disabled =
      props.disabled ??
      (chat.status === "streaming" ||
        message.role !== "assistant" ||
        latestAssistantMessage?.id !== message.id);
```

- [ ] **Step 4: Verify message tests pass**

Run:

```bash
pnpm --filter @anvia/react-ui test -- message.test.tsx
```

Expected: message tests pass with zero failures.

- [ ] **Step 5: Commit message behavior**

```bash
git add packages/react-ui/src/message.tsx packages/react-ui/test/message.test.tsx
git commit -m "fix: harden react ui message actions"
```

---

## Task 3: TDD Human-Input Question Behavior

**Files:**
- Modify: `packages/react-ui/test/human-input.test.tsx`
- Modify: `packages/react-ui/src/human-input.tsx`

- [ ] **Step 1: Add failing tests for all-prompt submit, seeded answers, and aria state**

Append these tests inside `describe("HumanInput primitives", () => { ... })`:

```tsx
  it("requires every prompt to be answered before submitting a tool question", () => {
    const question = multiPromptQuestion();
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

    const submit = screen.getByText("Submit");
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByText("Yes"));
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByText("US"));
    expect((submit as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(submit);

    expect(answerToolQuestion).toHaveBeenCalledWith("question_1", [
      { questionId: "confirm", answer: "Yes", choice: "yes" },
      { questionId: "region", answer: "US", choice: "us" },
    ]);
  });

  it("seeds selected choices from answered historical questions", () => {
    const question = multiPromptQuestion({
      status: "answered",
      answers: [
        { questionId: "confirm", answer: "No", choice: "no" },
        { questionId: "region", answer: "EU", choice: "eu" },
      ],
    });

    render(
      <ChatProvider
        controller={createChatController({
          humanInput: {
            approvals: { all: [], pending: [] },
            questions: { all: [question], pending: [] },
          },
        })}
      >
        <HumanInput.Questions filter="all" />
      </ChatProvider>,
    );

    expect(screen.getByText("No").getAttribute("data-state")).toBe("selected");
    expect(screen.getByText("No").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("EU").getAttribute("data-state")).toBe("selected");
    expect(screen.getByText("EU").getAttribute("aria-pressed")).toBe("true");
    expect((screen.getByText("Submit") as HTMLButtonElement).disabled).toBe(true);
  });
```

- [ ] **Step 2: Verify tests fail for missing behavior**

Run:

```bash
pnpm --filter @anvia/react-ui test -- human-input.test.tsx
```

Expected: submit becomes enabled after one answer, seeded selected choices are idle, or `aria-pressed` is missing.

- [ ] **Step 3: Implement human-input behavior**

In `packages/react-ui/src/human-input.tsx`, add `useEffect` to the React import:

```tsx
import {
  forwardRef,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
```

In `HumanInputQuestionChoice`, add `aria-pressed` to the rendered props:

```tsx
        "aria-pressed": props["aria-pressed"] ?? selected,
        "data-anvia-question-choice": "",
        "data-state": selected ? "selected" : "idle",
```

In `HumanInputQuestionSubmit`, replace the `disabled` calculation block with:

```tsx
    const expectedAnswerCount = question.question.questions.length;
    const hasAllAnswers = expectedAnswerCount > 0 && answers.length === expectedAnswerCount;
    const disabled =
      props.disabled ??
      (question.question.status !== "pending" ||
        chat.answeringQuestions.has(question.question.id) ||
        !hasAllAnswers);
```

Replace `QuestionProvider` with:

```tsx
function QuestionProvider({
  question,
  children,
}: {
  question: ToolQuestion;
  children?: ReactNode;
}) {
  const [answers, setAnswers] = useState<Record<string, ToolQuestionAnswer>>(() =>
    answersByPromptId(question.answers),
  );
  useEffect(() => {
    if (question.status !== "pending") {
      setAnswers(answersByPromptId(question.answers));
    }
  }, [question.answers, question.status]);
  const setAnswer = useCallback((prompt: ToolQuestionPrompt, answer: ToolQuestionAnswer) => {
    setAnswers((current) => ({ ...current, [prompt.id]: answer }));
  }, []);
  const value = useMemo<QuestionContextValue>(
    () => ({ question, answers, setAnswer }),
    [answers, question, setAnswer],
  );

  return <InternalQuestionProvider value={value}>{children}</InternalQuestionProvider>;
}

function answersByPromptId(
  answers: ToolQuestionAnswer[] | undefined,
): Record<string, ToolQuestionAnswer> {
  return Object.fromEntries((answers ?? []).map((answer) => [answer.questionId, answer]));
}
```

- [ ] **Step 4: Verify human-input tests pass**

Run:

```bash
pnpm --filter @anvia/react-ui test -- human-input.test.tsx
```

Expected: human-input tests pass with zero failures.

- [ ] **Step 5: Commit human-input behavior**

```bash
git add packages/react-ui/src/human-input.tsx packages/react-ui/test/human-input.test.tsx
git commit -m "fix: require complete human input answers"
```

---

## Task 4: Add Coverage Tests for Existing Branches

**Files:**
- Modify: `packages/react-ui/test/chat.test.tsx`
- Modify: `packages/react-ui/test/completion.test.tsx`
- Modify: `packages/react-ui/test/human-input.test.tsx`
- Modify: `packages/react-ui/test/message.test.tsx`

- [ ] **Step 1: Add chat branch coverage tests**

Append to `packages/react-ui/test/chat.test.tsx`:

```tsx
  it("renders empty state only before messages exist", () => {
    const { rerender } = render(
      <ChatProvider controller={createChatController()}>
        <Thread.Root>
          <Thread.Empty>No messages</Thread.Empty>
        </Thread.Root>
      </ChatProvider>,
    );

    expect(screen.getByText("No messages")).toBeTruthy();

    rerender(
      <ChatProvider
        controller={createChatController({ messages: [textMessage("user_1", "user", "Hi")] })}
      >
        <Thread.Root>
          <Thread.Empty>No messages</Thread.Empty>
        </Thread.Root>
      </ChatProvider>,
    );

    expect(screen.queryByText("No messages")).toBeNull();
  });

  it("stops streaming from the composer stop button", () => {
    const stop = vi.fn();

    render(
      <ChatProvider controller={createChatController({ status: "streaming", stop })}>
        <Composer.Root>
          <Composer.Stop />
        </Composer.Root>
      </ChatProvider>,
    );

    fireEvent.click(screen.getByText("Stop"));

    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("does not submit empty composer input or shift-enter input", () => {
    const sendMessage = vi.fn(async () => {});

    render(
      <ChatProvider controller={createChatController({ sendMessage })}>
        <Composer.Root>
          <Composer.Input />
          <Composer.Submit />
        </Composer.Root>
      </ChatProvider>,
    );

    fireEvent.click(screen.getByText("Send"));
    fireEvent.keyDown(screen.getByLabelText("Message"), { key: "Enter", shiftKey: true });

    expect(sendMessage).not.toHaveBeenCalled();
  });
```

Add `textMessage` to the helper import:

```tsx
import { createChatController, textMessage } from "./helpers";
```

- [ ] **Step 2: Add completion branch coverage tests**

Append to `packages/react-ui/test/completion.test.tsx`:

```tsx
  it("renders completion output with a render function", () => {
    render(
      <CompletionProvider controller={createCompletionController({ completion: "Answer" })}>
        <Completion.Root>
          <Completion.Output>{(completion) => <strong>{completion}</strong>}</Completion.Output>
        </Completion.Root>
      </CompletionProvider>,
    );

    expect(screen.getByText("Answer").tagName).toBe("STRONG");
  });

  it("stops streaming completion requests", () => {
    const stop = vi.fn();

    render(
      <CompletionProvider controller={createCompletionController({ status: "streaming", stop })}>
        <Completion.Form>
          <Completion.Stop />
        </Completion.Form>
      </CompletionProvider>,
    );

    fireEvent.click(screen.getByText("Stop"));

    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("does not submit blank completion input", () => {
    const complete = vi.fn(async () => {});

    render(
      <CompletionProvider controller={createCompletionController({ complete })}>
        <Completion.Form aria-label="Completion form">
          <Completion.Input />
          <Completion.Submit />
        </Completion.Form>
      </CompletionProvider>,
    );

    fireEvent.submit(screen.getByLabelText("Completion form"));

    expect(complete).not.toHaveBeenCalled();
  });
```

- [ ] **Step 3: Add human-input branch coverage tests**

Append to `packages/react-ui/test/human-input.test.tsx`:

```tsx
  it("renders custom approval and question children", () => {
    const approval = pendingApproval({ id: "approval_custom" });
    const question = multiPromptQuestion({ id: "question_custom" });

    render(
      <ChatProvider
        controller={createChatController({
          humanInput: {
            approvals: { all: [approval], pending: [approval] },
            questions: { all: [question], pending: [question] },
          },
        })}
      >
        <HumanInput.Approvals>{(item) => <span>{item.id}</span>}</HumanInput.Approvals>
        <HumanInput.Questions>{(item) => <span>{item.id}</span>}</HumanInput.Questions>
      </ChatProvider>,
    );

    expect(screen.getByText("approval_custom")).toBeTruthy();
    expect(screen.getByText("question_custom")).toBeTruthy();
  });

  it("uses the default choice when no value is supplied and records custom answers", () => {
    const question = multiPromptQuestion({
      questions: [
        {
          id: "confirm",
          question: "Continue?",
          choices: [{ label: "Yes", value: "yes" }],
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
        <HumanInput.Questions>
          <HumanInput.Question>
            <HumanInput.QuestionPrompt>
              <HumanInput.QuestionChoice custom answer="Custom yes" />
            </HumanInput.QuestionPrompt>
            <HumanInput.QuestionSubmit />
          </HumanInput.Question>
        </HumanInput.Questions>
      </ChatProvider>,
    );

    fireEvent.click(screen.getByText("Yes"));
    fireEvent.click(screen.getByText("Submit"));

    expect(answerToolQuestion).toHaveBeenCalledWith("question_1", [
      { questionId: "confirm", answer: "Custom yes", choice: "yes", custom: true },
    ]);
  });
```

- [ ] **Step 4: Add message branch coverage tests**

Append to `packages/react-ui/test/message.test.tsx`:

```tsx
  it("renders message root and part children as render functions", () => {
    const messages = [textMessage("assistant_1", "assistant", "Hello")];

    render(
      <ChatProvider controller={createChatController({ messages })}>
        <Thread.Root>
          <Thread.Messages>
            <Message.Root>{(message) => <span>{message.role}</span>}</Message.Root>
          </Thread.Messages>
        </Thread.Root>
      </ChatProvider>,
    );

    expect(screen.getByText("assistant")).toBeTruthy();
  });

  it("renders pending tool calls with pending render gate", () => {
    const messages: UIMessage[] = [
      {
        id: "assistant_1",
        role: "assistant",
        parts: [
          {
            id: "tool_pending",
            type: "tool",
            toolName: "lookup",
            toolCallId: "call_pending",
            state: "input-streaming",
          },
        ],
      },
    ];

    render(
      <ChatProvider controller={createChatController({ messages })}>
        <Thread.Root>
          <Thread.Messages>
            <Message.Root>
              <Message.Parts>
                <Message.Part>
                  <Message.Tool renderWhen="pending" />
                </Message.Part>
              </Message.Parts>
            </Message.Root>
          </Thread.Messages>
        </Thread.Root>
      </ChatProvider>,
    );

    expect(screen.getByText("lookup")).toBeTruthy();
  });
```

- [ ] **Step 5: Run coverage and inspect remaining gaps**

Run:

```bash
pnpm --filter @anvia/react-ui coverage
```

Expected: coverage meets or exceeds the existing 80% thresholds. If this command fails, stop and inspect the uncovered line report before continuing; do not change coverage thresholds.

- [ ] **Step 6: Commit coverage tests**

```bash
git add packages/react-ui/test
git commit -m "test: expand react ui behavior coverage"
```

---

## Task 5: Split Shared Internals

**Files:**
- Create: `packages/react-ui/src/shared/contexts.tsx`
- Create: `packages/react-ui/src/shared/format.ts`
- Create: `packages/react-ui/src/shared/index.ts`
- Create: `packages/react-ui/src/shared/primitive.tsx`
- Modify: `packages/react-ui/src/internal.tsx`
- Modify: `packages/react-ui/src/shared.ts`

- [ ] **Step 1: Move primitive helpers**

Create `packages/react-ui/src/shared/primitive.tsx` by moving these exports from `src/internal.tsx` without changing runtime behavior:

- `PrimitiveProps`
- `PrimitiveRef`
- `renderPrimitive`
- `composeRefs`

The final export list in the file must be:

```tsx
import { Slot } from "@radix-ui/react-slot";
import {
  type ComponentPropsWithoutRef,
  type ComponentPropsWithRef,
  createElement,
  type ElementType,
  type ReactElement,
  type Ref,
  type RefCallback,
} from "react";

export type PrimitiveProps<TElement extends ElementType = "div"> = Omit<
  ComponentPropsWithoutRef<TElement>,
  "asChild"
> & {
  asChild?: boolean;
};

export type PrimitiveRef<TElement extends ElementType> = ComponentPropsWithRef<TElement>["ref"];

export function renderPrimitive<TElement extends ElementType>(
  element: TElement,
  props: PrimitiveProps<TElement>,
  ref?: Ref<unknown>,
): ReactElement {
  const { asChild, ...rest } = props;
  const Component = asChild ? Slot : element;
  const nextProps = ref === undefined ? rest : { ...rest, ref };
  return createElement(Component, nextProps);
}

export function composeRefs<T>(...refs: Array<Ref<T> | undefined>): RefCallback<T> {
  return (node) => {
    for (const ref of refs) {
      if (typeof ref === "function") {
        ref(node);
      } else if (ref !== undefined && ref !== null) {
        ref.current = node;
      }
    }
  };
}
```

- [ ] **Step 2: Move formatting helpers**

Create `packages/react-ui/src/shared/format.ts`:

```ts
import type { UIMessage, UIMessagePart } from "@anvia/react";

export function stringifyValue(value: unknown): string {
  if (value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function messageText(message: UIMessage): string {
  return message.parts
    .filter((part): part is Extract<UIMessagePart, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("");
}
```

- [ ] **Step 3: Move contexts and providers**

Create `packages/react-ui/src/shared/contexts.tsx` by moving all controller/context types, context objects, providers, and hooks from `src/internal.tsx`. Keep these exported names:

```tsx
export type ChatController<TEvent = unknown> = UseChatResult<TEvent>;
export type CompletionController<TEvent = unknown> = UseCompletionResult<TEvent>;
export type ChatProviderProps<TEvent = unknown> = {
  controller: ChatController<TEvent>;
  children?: ReactNode;
};
export type CompletionProviderProps<TEvent = unknown> = {
  controller: CompletionController<TEvent>;
  children?: ReactNode;
};
export type ThreadContextValue = {
  viewportRef: MutableRefObject<HTMLElement | null>;
  atBottom: boolean;
  setAtBottom(atBottom: boolean): void;
  scrollToBottom(behavior?: ScrollBehavior): void;
};
export type ComposerContextValue = {
  input: string;
  setInput(input: string): void;
  submit(): Promise<void>;
  stop(): void;
  status: ChatController["status"];
  canSubmit: boolean;
  canStop: boolean;
};
export type CompletionInputContextValue = {
  input: string;
  setInput(input: string): void;
  submit(): Promise<void>;
  stop(): void;
  status: CompletionController["status"];
  canSubmit: boolean;
  canStop: boolean;
};
export type MessageContextValue = { message: UIMessage };
export type MessagePartContextValue = { part: UIMessagePart };
export type ApprovalContextValue = { approval: ToolApproval };
export type QuestionContextValue = {
  question: ToolQuestion;
  answers: Record<string, ToolQuestionAnswer>;
  setAnswer(prompt: ToolQuestionPrompt, answer: ToolQuestionAnswer): void;
};
export type QuestionPromptContextValue = { prompt: ToolQuestionPrompt };
```

Move these functions unchanged:

```txt
ChatProvider
CompletionProvider
InternalThreadProvider
InternalComposerProvider
InternalCompletionInputProvider
InternalMessageProvider
InternalMessagePartProvider
InternalApprovalProvider
InternalQuestionProvider
InternalQuestionPromptProvider
useChatContext
useCompletionContext
useThread
useComposer
useCompletionInput
useMessage
useMessagePart
useApproval
useQuestion
useQuestionPrompt
useHumanInput
```

- [ ] **Step 4: Create shared barrel and compatibility internal barrel**

Create `packages/react-ui/src/shared/index.ts`:

```ts
export type {
  ApprovalContextValue,
  ChatController,
  ChatProviderProps,
  CompletionController,
  CompletionInputContextValue,
  CompletionProviderProps,
  ComposerContextValue,
  MessageContextValue,
  MessagePartContextValue,
  QuestionContextValue,
  QuestionPromptContextValue,
  ThreadContextValue,
} from "./contexts";
export {
  ChatProvider,
  CompletionProvider,
  InternalApprovalProvider,
  InternalCompletionInputProvider,
  InternalComposerProvider,
  InternalMessagePartProvider,
  InternalMessageProvider,
  InternalQuestionPromptProvider,
  InternalQuestionProvider,
  InternalThreadProvider,
  useApproval,
  useChatContext,
  useCompletionContext,
  useCompletionInput,
  useComposer,
  useHumanInput,
  useMessage,
  useMessagePart,
  useQuestion,
  useQuestionPrompt,
  useThread,
} from "./contexts";
export { messageText, stringifyValue } from "./format";
export type { PrimitiveProps, PrimitiveRef } from "./primitive";
export { composeRefs, renderPrimitive } from "./primitive";
```

Replace `packages/react-ui/src/internal.tsx` with:

```ts
export * from "./shared";
```

Replace `packages/react-ui/src/shared.ts` with:

```ts
export type {
  ApprovalContextValue,
  ChatController,
  ChatProviderProps,
  CompletionController,
  CompletionInputContextValue,
  CompletionProviderProps,
  ComposerContextValue,
  MessageContextValue,
  MessagePartContextValue,
  PrimitiveProps,
  PrimitiveRef,
  QuestionContextValue,
  QuestionPromptContextValue,
  ThreadContextValue,
} from "./shared/index";
export {
  ChatProvider,
  CompletionProvider,
  useApproval,
  useChatContext,
  useCompletionContext,
  useCompletionInput,
  useComposer,
  useHumanInput,
  useMessage,
  useMessagePart,
  useQuestion,
  useQuestionPrompt,
  useThread,
} from "./shared/index";
```

- [ ] **Step 5: Verify shared split**

Run:

```bash
pnpm --filter @anvia/react-ui typecheck
pnpm --filter @anvia/react-ui test
```

Expected: both commands pass with zero failures.

- [ ] **Step 6: Commit shared split**

```bash
git add packages/react-ui/src/shared packages/react-ui/src/internal.tsx packages/react-ui/src/shared.ts
git commit -m "refactor: split react ui shared internals"
```

---

## Task 6: Split Chat, Completion, Message, and Human-Input Modules

**Files:**
- Create: `packages/react-ui/src/chat/composer.tsx`
- Create: `packages/react-ui/src/chat/index.ts`
- Create: `packages/react-ui/src/chat/thread.tsx`
- Create: `packages/react-ui/src/completion/index.tsx`
- Create: `packages/react-ui/src/human-input/approvals.tsx`
- Create: `packages/react-ui/src/human-input/index.ts`
- Create: `packages/react-ui/src/human-input/questions.tsx`
- Create: `packages/react-ui/src/message/actions.tsx`
- Create: `packages/react-ui/src/message/index.ts`
- Create: `packages/react-ui/src/message/parts.tsx`
- Modify: `packages/react-ui/src/chat.tsx`
- Modify: `packages/react-ui/src/completion.tsx`
- Modify: `packages/react-ui/src/human-input.tsx`
- Modify: `packages/react-ui/src/message.tsx`

- [ ] **Step 1: Split chat module**

Move from `src/chat.tsx` into `src/chat/thread.tsx`:

```txt
ThreadMessagesChildren type
ThreadRoot component
ThreadViewportProps type
ThreadViewport component
ThreadEmpty component
ThreadMessagesProps type
ThreadMessages component
ThreadScrollToBottom component
defaultMessage function
Thread namespace export
```

Export prop types from `thread.tsx`:

```tsx
export type ThreadMessagesChildren = ReactNode | ((message: UIMessage) => ReactNode);
export type ThreadRootProps = PrimitiveProps<"div">;
export type ThreadViewportProps = PrimitiveProps<"div"> & { autoScroll?: boolean };
export type ThreadEmptyProps = PrimitiveProps<"div">;
export type ThreadMessagesProps = PrimitiveProps<"div"> & { children?: ThreadMessagesChildren };
export type ThreadScrollToBottomProps = PrimitiveProps<"button">;
```

Move from `src/chat.tsx` into `src/chat/composer.tsx`:

```txt
ComposerRoot component
ComposerInput component
ComposerSubmit component
ComposerStop component
Composer namespace export
```

Export prop types from `composer.tsx`:

```tsx
export type ComposerRootProps = PrimitiveProps<"form">;
export type ComposerInputProps = PrimitiveProps<"textarea">;
export type ComposerSubmitProps = PrimitiveProps<"button">;
export type ComposerStopProps = PrimitiveProps<"button">;
```

Create `packages/react-ui/src/chat/index.ts`:

```ts
export type {
  ComposerInputProps,
  ComposerRootProps,
  ComposerStopProps,
  ComposerSubmitProps,
} from "./composer";
export { Composer } from "./composer";
export type {
  ThreadEmptyProps,
  ThreadMessagesChildren,
  ThreadMessagesProps,
  ThreadRootProps,
  ThreadScrollToBottomProps,
  ThreadViewportProps,
} from "./thread";
export { Thread } from "./thread";
export type {
  ChatController,
  ChatProviderProps,
  ComposerContextValue,
  ThreadContextValue,
} from "../shared";
export { ChatProvider, useChatContext, useComposer, useThread } from "../shared";
```

Replace `packages/react-ui/src/chat.tsx` with:

```ts
export * from "./chat/index";
```

- [ ] **Step 2: Split completion module**

Move all implementation from `src/completion.tsx` into `src/completion/index.tsx`. Export these prop types:

```tsx
export type CompletionOutputChildren = ReactNode | ((completion: string) => ReactNode);
export type CompletionRootProps = PrimitiveProps<"div">;
export type CompletionOutputProps = PrimitiveProps<"div"> & {
  children?: CompletionOutputChildren;
};
export type CompletionFormProps = PrimitiveProps<"form">;
export type CompletionInputProps = PrimitiveProps<"textarea">;
export type CompletionSubmitProps = PrimitiveProps<"button">;
export type CompletionStopProps = PrimitiveProps<"button">;
```

Keep these exports at the bottom of `src/completion/index.tsx`:

```tsx
export const Completion = {
  Root: CompletionRoot,
  Output: CompletionOutput,
  Form: CompletionForm,
  Input: CompletionInput,
  Submit: CompletionSubmit,
  Stop: CompletionStop,
} as const;

export type {
  CompletionController,
  CompletionInputContextValue,
  CompletionProviderProps,
} from "../shared";
export { CompletionProvider, useCompletionContext, useCompletionInput } from "../shared";
```

Replace `packages/react-ui/src/completion.tsx` with:

```ts
export * from "./completion/index";
```

- [ ] **Step 3: Split message module**

Move message root/content/parts/renderers from `src/message.tsx` into `src/message/parts.tsx`:

```txt
MessageChildren type
MessagePartChildren type
MessagePartsFilter type
MessageToolPart type
MessageToolChildren type
MessageToolRenderWhen type
MessageRoot component
MessageContent component
MessageParts component
MessagePart component
MessageText component
MessageReasoning component
MessageTool component
MessageData component
MessageError component
defaultPart function
defaultToolContent function
shouldRenderTool function
```

Export these prop types from `parts.tsx`:

```tsx
export type MessageChildren = ReactNode | ((message: UIMessage) => ReactNode);
export type MessagePartChildren = ReactNode | ((part: UIMessagePart) => ReactNode);
export type MessagePartsFilter = (part: UIMessagePart) => boolean;
export type MessageToolPart = Extract<UIMessagePart, { type: "tool" }>;
export type MessageToolChildren = ReactNode | ((part: MessageToolPart) => ReactNode);
export type MessageToolRenderWhen = "always" | "pending" | "settled";
export type MessageRootProps = Omit<PrimitiveProps<"article">, "children"> & {
  children?: MessageChildren;
};
export type MessageContentProps = PrimitiveProps<"div">;
export type MessagePartsProps = Omit<PrimitiveProps<"div">, "children"> & {
  children?: MessagePartChildren;
  filter?: MessagePartsFilter;
};
export type MessagePartProps = Omit<PrimitiveProps<"div">, "children"> & {
  children?: MessagePartChildren;
};
export type MessageTextProps = PrimitiveProps<"span">;
export type MessageReasoningProps = PrimitiveProps<"details">;
export type MessageToolProps = Omit<PrimitiveProps<"div">, "children"> & {
  children?: MessageToolChildren;
  renderWhen?: MessageToolRenderWhen;
};
export type MessageDataProps = PrimitiveProps<"pre">;
export type MessageErrorProps = PrimitiveProps<"div">;
```

Move message action components from `src/message.tsx` into `src/message/actions.tsx`:

```txt
MessageActions component
MessageCopy component
MessageRegenerate component
MessageCopyState type
```

Export these prop types from `actions.tsx`:

```tsx
export type MessageActionsProps = PrimitiveProps<"div">;
export type MessageCopyState = "idle" | "copied" | "error";
export type MessageCopyProps = PrimitiveProps<"button">;
export type MessageRegenerateProps = PrimitiveProps<"button">;
```

Create `packages/react-ui/src/message/index.ts`:

```ts
import {
  MessageContent,
  MessageData,
  MessageError,
  MessagePart,
  MessageParts,
  MessageReasoning,
  MessageRoot,
  MessageText,
  MessageTool,
} from "./parts";
import { MessageActions, MessageCopy, MessageRegenerate } from "./actions";

export type {
  MessageActionsProps,
  MessageCopyProps,
  MessageCopyState,
  MessageRegenerateProps,
} from "./actions";
export { MessageActions, MessageCopy, MessageRegenerate } from "./actions";
export type {
  MessageChildren,
  MessageContentProps,
  MessageDataProps,
  MessageErrorProps,
  MessagePartChildren,
  MessagePartProps,
  MessagePartsFilter,
  MessagePartsProps,
  MessageReasoningProps,
  MessageRootProps,
  MessageTextProps,
  MessageToolChildren,
  MessageToolPart,
  MessageToolProps,
  MessageToolRenderWhen,
} from "./parts";
export {
  MessageContent,
  MessageData,
  MessageError,
  MessagePart,
  MessageParts,
  MessageReasoning,
  MessageRoot,
  MessageText,
  MessageTool,
} from "./parts";

export const Message = {
  Root: MessageRoot,
  Content: MessageContent,
  Parts: MessageParts,
  Part: MessagePart,
  Text: MessageText,
  Reasoning: MessageReasoning,
  Tool: MessageTool,
  Data: MessageData,
  Error: MessageError,
  Actions: MessageActions,
  Copy: MessageCopy,
  Regenerate: MessageRegenerate,
} as const;

export type { MessageContextValue, MessagePartContextValue } from "../shared";
export { useChatContext, useMessage, useMessagePart } from "../shared";
```

Replace `packages/react-ui/src/message.tsx` with:

```ts
export * from "./message/index";
```

- [ ] **Step 4: Split human-input module**

Move approvals from `src/human-input.tsx` into `src/human-input/approvals.tsx`:

```txt
ApprovalChildren type
HumanInputFilter type
HumanInputApprovals component
HumanInputApproval component
HumanInputApprove component
HumanInputReject component
defaultApprovalContent function
```

Export these types from `approvals.tsx`:

```tsx
export type ApprovalChildren = ReactNode | ((approval: ToolApproval) => ReactNode);
export type HumanInputFilter = "pending" | "all";
export type HumanInputApprovalsProps = PrimitiveProps<"div"> & {
  filter?: HumanInputFilter;
  children?: ApprovalChildren;
};
export type HumanInputApprovalProps = PrimitiveProps<"div"> & {
  children?: ApprovalChildren;
};
export type HumanInputApproveProps = PrimitiveProps<"button">;
export type HumanInputRejectProps = PrimitiveProps<"button">;
```

Move questions from `src/human-input.tsx` into `src/human-input/questions.tsx`:

```txt
QuestionChildren type
HumanInputQuestions component
HumanInputQuestion component
HumanInputQuestionPrompt component
HumanInputQuestionChoice component
HumanInputQuestionSubmit component
QuestionProvider function
answersByPromptId function
defaultQuestionContent function
defaultQuestionPrompt function
```

Export these types from `questions.tsx`:

```tsx
export type QuestionChildren = ReactNode | ((question: ToolQuestion) => ReactNode);
export type HumanInputQuestionsProps = PrimitiveProps<"div"> & {
  filter?: HumanInputFilter;
  children?: QuestionChildren;
};
export type HumanInputQuestionProps = PrimitiveProps<"div"> & {
  children?: QuestionChildren;
};
export type HumanInputQuestionPromptProps = PrimitiveProps<"div"> & {
  promptId?: string;
};
export type HumanInputQuestionChoiceProps = PrimitiveProps<"button"> & {
  value?: string;
  answer?: string;
  custom?: boolean;
};
export type HumanInputQuestionSubmitProps = PrimitiveProps<"button">;
```

Create `packages/react-ui/src/human-input/index.ts`:

```ts
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
  HumanInputQuestions,
  HumanInputQuestionSubmit,
} from "./questions";

export type {
  ApprovalChildren,
  HumanInputApprovalProps,
  HumanInputApprovalsProps,
  HumanInputApproveProps,
  HumanInputFilter,
  HumanInputRejectProps,
} from "./approvals";
export {
  HumanInputApproval,
  HumanInputApprovals,
  HumanInputApprove,
  HumanInputReject,
} from "./approvals";
export type {
  HumanInputQuestionChoiceProps,
  HumanInputQuestionPromptProps,
  HumanInputQuestionProps,
  HumanInputQuestionsProps,
  HumanInputQuestionSubmitProps,
  QuestionChildren,
} from "./questions";
export {
  HumanInputQuestion,
  HumanInputQuestionChoice,
  HumanInputQuestionPrompt,
  HumanInputQuestions,
  HumanInputQuestionSubmit,
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
} from "../shared";
export { useApproval, useChatContext, useHumanInput, useQuestion, useQuestionPrompt } from "../shared";
```

Replace `packages/react-ui/src/human-input.tsx` with:

```ts
export * from "./human-input/index";
```

- [ ] **Step 5: Verify module split**

Run:

```bash
pnpm --filter @anvia/react-ui typecheck
pnpm --filter @anvia/react-ui test
```

Expected: both commands pass with zero failures.

- [ ] **Step 6: Commit module split**

```bash
git add packages/react-ui/src
git commit -m "refactor: split react ui primitive modules"
```

---

## Task 7: Export Prop Types, Add Public API Smoke Tests, and Update Docs

**Files:**
- Modify: `packages/react-ui/src/index.ts`
- Modify: `packages/react-ui/src/chat.tsx`
- Modify: `packages/react-ui/src/completion.tsx`
- Modify: `packages/react-ui/src/human-input.tsx`
- Modify: `packages/react-ui/src/message.tsx`
- Create: `packages/react-ui/test/public-api.test.tsx`
- Modify: `apps/www/src/content/docs/packages/react-ui/reference.md`
- Modify: `apps/www/src/content/docs/react-ui/reference.md`

- [ ] **Step 1: Add failing public API smoke test**

Create `packages/react-ui/test/public-api.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";

import { Composer, Completion, HumanInput, Message, Thread } from "../src";
import type {
  ComposerInputProps,
  CompletionInputProps,
  HumanInputQuestionSubmitProps,
  MessageToolProps,
  ThreadViewportProps,
} from "../src";
import { Composer as ChatComposer } from "../src/chat";
import { Completion as CompletionNamespace } from "../src/completion";
import { HumanInput as HumanInputNamespace } from "../src/human-input";
import { Message as MessageNamespace } from "../src/message";
import { Thread as ChatThread } from "../src/chat";

function acceptsPublicProps(
  thread: ThreadViewportProps,
  composer: ComposerInputProps,
  completion: CompletionInputProps,
  tool: MessageToolProps,
  submit: HumanInputQuestionSubmitProps,
) {
  return { thread, composer, completion, tool, submit };
}

describe("public API", () => {
  it("exports namespaces from root and subpath barrels", () => {
    expect(Thread.Root).toBe(ChatThread.Root);
    expect(Composer.Root).toBe(ChatComposer.Root);
    expect(Completion.Root).toBe(CompletionNamespace.Root);
    expect(Message.Root).toBe(MessageNamespace.Root);
    expect(HumanInput.Questions).toBe(HumanInputNamespace.Questions);
  });

  it("exports reusable prop types", () => {
    const props = acceptsPublicProps(
      { autoScroll: false, className: "viewport" },
      { placeholder: "Message" },
      { placeholder: "Prompt" },
      { renderWhen: "settled" },
      { disabled: true },
    );

    expect(props.thread.autoScroll).toBe(false);
    expect(props.tool.renderWhen).toBe("settled");
  });
});
```

- [ ] **Step 2: Verify typecheck fails before exports are complete**

Run:

```bash
pnpm --filter @anvia/react-ui typecheck
```

Expected: TypeScript reports missing exported prop types if Task 6 did not export all root-level types yet.

- [ ] **Step 3: Export prop types from root**

Update `packages/react-ui/src/index.ts` so it exports prop types from each public subpath. The type export block should include these names:

```ts
export type {
  ComposerInputProps,
  ComposerRootProps,
  ComposerStopProps,
  ComposerSubmitProps,
  ThreadEmptyProps,
  ThreadMessagesChildren,
  ThreadMessagesProps,
  ThreadRootProps,
  ThreadScrollToBottomProps,
  ThreadViewportProps,
} from "./chat";
export type {
  CompletionFormProps,
  CompletionInputProps,
  CompletionOutputChildren,
  CompletionOutputProps,
  CompletionRootProps,
  CompletionStopProps,
  CompletionSubmitProps,
} from "./completion";
export type {
  ApprovalChildren,
  HumanInputApprovalProps,
  HumanInputApprovalsProps,
  HumanInputApproveProps,
  HumanInputFilter,
  HumanInputQuestionChoiceProps,
  HumanInputQuestionPromptProps,
  HumanInputQuestionProps,
  HumanInputQuestionsProps,
  HumanInputQuestionSubmitProps,
  HumanInputRejectProps,
  QuestionChildren,
} from "./human-input";
export type {
  MessageActionsProps,
  MessageChildren,
  MessageContentProps,
  MessageCopyProps,
  MessageCopyState,
  MessageDataProps,
  MessageErrorProps,
  MessagePartChildren,
  MessagePartProps,
  MessagePartsProps,
  MessageReasoningProps,
  MessageRegenerateProps,
  MessageRootProps,
  MessageTextProps,
  MessageToolChildren,
  MessageToolProps,
} from "./message";
```

Keep existing exports for `MessagePartsFilter`, `MessageToolPart`, and `MessageToolRenderWhen`.

- [ ] **Step 4: Update docs reference lists**

In `apps/www/src/content/docs/packages/react-ui/reference.md`, add this section after `## Shared primitive types`:

```md
## Component prop types

Reusable component prop types are exported for wrapper components:

- Chat: `ThreadRootProps`, `ThreadViewportProps`, `ThreadMessagesProps`, `ThreadEmptyProps`, `ThreadScrollToBottomProps`, `ComposerRootProps`, `ComposerInputProps`, `ComposerSubmitProps`, `ComposerStopProps`
- Completion: `CompletionRootProps`, `CompletionOutputProps`, `CompletionFormProps`, `CompletionInputProps`, `CompletionSubmitProps`, `CompletionStopProps`
- Message: `MessageRootProps`, `MessageContentProps`, `MessagePartsProps`, `MessagePartProps`, `MessageTextProps`, `MessageReasoningProps`, `MessageToolProps`, `MessageDataProps`, `MessageErrorProps`, `MessageActionsProps`, `MessageCopyProps`, `MessageRegenerateProps`
- Human input: `HumanInputApprovalsProps`, `HumanInputApprovalProps`, `HumanInputApproveProps`, `HumanInputRejectProps`, `HumanInputQuestionsProps`, `HumanInputQuestionProps`, `HumanInputQuestionPromptProps`, `HumanInputQuestionChoiceProps`, `HumanInputQuestionSubmitProps`
```

In `apps/www/src/content/docs/react-ui/reference.md`, add this bullet under `## Hooks`:

```md
## Component prop types

The root package and subpath entrypoints export reusable prop types for every primitive, including `ThreadViewportProps`, `ComposerInputProps`, `MessageToolProps`, `CompletionInputProps`, and `HumanInputQuestionSubmitProps`.
```

- [ ] **Step 5: Verify public API and docs**

Run:

```bash
pnpm --filter @anvia/react-ui typecheck
pnpm --filter @anvia/react-ui test -- public-api.test.tsx
pnpm --filter www reference-check
```

Expected: all three commands pass.

- [ ] **Step 6: Commit public API exports**

```bash
git add packages/react-ui/src packages/react-ui/test/public-api.test.tsx apps/www/src/content/docs/packages/react-ui/reference.md apps/www/src/content/docs/react-ui/reference.md
git commit -m "feat: export react ui primitive prop types"
```

---

## Task 8: Scope Default CSS and Verify Build Outputs

**Files:**
- Modify: `packages/react-ui/src/styles.css`
- Modify: `packages/react-ui/test/public-api.test.tsx`

- [ ] **Step 1: Add failing stylesheet smoke test**

Append to `packages/react-ui/test/public-api.test.tsx`:

```tsx
import { readFileSync } from "node:fs";
```

Append this test inside `describe("public API", () => { ... })`:

```tsx
  it("does not style every disabled data-state globally", () => {
    const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

    expect(css).not.toContain('\n[data-state="disabled"]');
    expect(css).toContain('[data-anvia-submit][data-state="disabled"]');
  });
```

- [ ] **Step 2: Verify stylesheet test fails**

Run:

```bash
pnpm --filter @anvia/react-ui test -- public-api.test.tsx
```

Expected: test fails because `styles.css` still contains the bare `[data-state="disabled"]` selector.

- [ ] **Step 3: Scope disabled selector**

Replace this block in `packages/react-ui/src/styles.css`:

```css
[data-state="disabled"] {
  opacity: 0.55;
}
```

With:

```css
[data-anvia-submit][data-state="disabled"],
[data-anvia-stop][data-state="disabled"],
[data-anvia-copy][data-state="disabled"],
[data-anvia-regenerate][data-state="disabled"],
[data-anvia-approve][data-state="disabled"],
[data-anvia-reject][data-state="disabled"],
[data-anvia-question-submit][data-state="disabled"],
[data-anvia-completion-submit][data-state="disabled"],
[data-anvia-completion-stop][data-state="disabled"] {
  opacity: 0.55;
}
```

- [ ] **Step 4: Verify stylesheet test passes**

Run:

```bash
pnpm --filter @anvia/react-ui test -- public-api.test.tsx
```

Expected: public API tests pass with zero failures.

- [ ] **Step 5: Commit stylesheet scoping**

```bash
git add packages/react-ui/src/styles.css packages/react-ui/test/public-api.test.tsx
git commit -m "fix: scope react ui disabled styles"
```

---

## Task 9: Final Coverage, Build, and Quality Gate

**Files:**
- Inspect all modified files.
- Modify only files needed to fix command failures.

- [ ] **Step 1: Run package tests**

```bash
pnpm --filter @anvia/react-ui test
```

Expected: all React UI test files pass.

- [ ] **Step 2: Run package coverage**

```bash
pnpm --filter @anvia/react-ui coverage
```

Expected: line, branch, function, and statement coverage all meet or exceed 80%. If a metric fails, stop with the uncovered line report; keep the threshold unchanged.

- [ ] **Step 3: Run package typecheck**

```bash
pnpm --filter @anvia/react-ui typecheck
```

Expected: TypeScript exits with code 0.

- [ ] **Step 4: Run package build**

```bash
pnpm --filter @anvia/react-ui build
```

Expected: tsup builds `index`, `chat`, `completion`, `human-input`, `message`, `shared`, and copies `styles.css` into `dist`.

- [ ] **Step 5: Run Biome on package**

```bash
pnpm exec biome check packages/react-ui
```

Expected: Biome reports no errors.

- [ ] **Step 6: Run docs reference check**

```bash
pnpm --filter www reference-check
```

Expected: `@anvia/react-ui` has zero undocumented entrypoints and zero undocumented exports.

- [ ] **Step 7: Inspect git status and generated files**

```bash
git status --short --ignored packages/react-ui apps/www/src/content/docs/packages/react-ui/reference.md apps/www/src/content/docs/react-ui/reference.md
```

Expected: source, test, docs, and plan files may be modified; `packages/react-ui/dist/`, `packages/react-ui/coverage/`, and `packages/react-ui/node_modules/` remain ignored.

- [ ] **Step 8: Commit final fixes**

If Step 1 through Step 7 required additional edits, commit them:

```bash
git add packages/react-ui apps/www/src/content/docs/packages/react-ui/reference.md apps/www/src/content/docs/react-ui/reference.md
git commit -m "test: satisfy react ui coverage gate"
```

If no additional edits were required, do not create an empty commit.

---

## Self-Review Checklist

- The plan covers structure split, prop type exports, behavior fixes, CSS scoping, tests, docs, and validation.
- New behavior has failing-test steps before production edits.
- Public entrypoints remain stable.
- Coverage thresholds are not lowered.
- No task instructs editing generated `dist/`, `coverage/`, or `node_modules/` by hand.
