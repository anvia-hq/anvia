import type { UIMessage } from "@anvia/react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChatProvider, Message, Thread } from "../src";
import { createChatController, textMessage } from "./helpers";

const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");

afterEach(() => {
  cleanup();
  if (originalClipboardDescriptor === undefined) {
    Reflect.deleteProperty(navigator, "clipboard");
  } else {
    Object.defineProperty(navigator, "clipboard", originalClipboardDescriptor);
  }
});

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
          {
            id: "attachment_1",
            type: "attachment",
            attachment: {
              id: "image_1",
              type: "image",
              name: "photo.png",
              mediaType: "image/png",
              data: "aGVsbG8=",
            },
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
    expect(screen.getByText("photo.png")).toBeTruthy();
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

  it("renders granular tool primitives", () => {
    const messages: UIMessage[] = [
      {
        id: "assistant_1",
        role: "assistant",
        parts: [
          {
            id: "tool_1",
            type: "tool",
            toolName: "lookup",
            toolCallId: "call_1",
            state: "output-available",
            input: { id: "A-100" },
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
              <Message.Parts>
                <Message.Part>
                  <Message.Tool>
                    <Message.ToolName />
                    <Message.ToolStatus />
                    <Message.ToolInput />
                    <Message.ToolOutput />
                    <Message.ToolError />
                  </Message.Tool>
                </Message.Part>
              </Message.Parts>
            </Message.Root>
          </Thread.Messages>
        </Thread.Root>
      </ChatProvider>,
    );

    expect(screen.getByText("lookup")).toBeTruthy();
    expect(screen.getByText("Done")).toBeTruthy();
    expect(screen.getByText(/"id": "A-100"/)).toBeTruthy();
    expect(screen.getByText(/"status": "shipped"/)).toBeTruthy();
  });

  it("renders markdown with overridable code components", () => {
    const messages = [
      textMessage("assistant_1", "assistant", "Use `pnpm`.\n\n```ts\nconst ok = true;\n```"),
    ];

    render(
      <ChatProvider controller={createChatController({ messages })}>
        <Thread.Root>
          <Thread.Messages>
            <Message.Root>
              <Message.Markdown
                components={{
                  code({ children, className }) {
                    return (
                      <code className={className} data-testid="custom-code">
                        {children}
                      </code>
                    );
                  },
                }}
              />
            </Message.Root>
          </Thread.Messages>
        </Thread.Root>
      </ChatProvider>,
    );

    expect(screen.getByText(/Use/)).toBeTruthy();
    expect(screen.getAllByTestId("custom-code")).toHaveLength(2);
  });

  it("renders default markdown code blocks without nested pre elements", () => {
    const messages = [textMessage("assistant_1", "assistant", "```ts\nconst ok = true;\n```")];

    const { container } = render(
      <ChatProvider controller={createChatController({ messages })}>
        <Thread.Root>
          <Thread.Messages>
            <Message.Root>
              <Message.Markdown />
            </Message.Root>
          </Thread.Messages>
        </Thread.Root>
      </ChatProvider>,
    );

    expect(container.querySelectorAll("[data-anvia-code-block]")).toHaveLength(1);
    expect(container.querySelector("[data-anvia-code-block] pre")).toBeNull();
    expect(screen.getByText("const ok = true;")).toBeTruthy();
  });

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
    const writeText = vi.fn(async () => {
      throw new Error("denied");
    });
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
      expect(screen.getByText("Copy").getAttribute("data-state")).toBe("error");
    });
  });

  it("resets copy state when message text changes", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    const renderThread = (text: string) => (
      <ChatProvider
        controller={createChatController({
          messages: [textMessage("assistant_1", "assistant", text)],
        })}
      >
        <Thread.Root>
          <Thread.Messages>
            <Message.Root>
              <Message.Copy />
            </Message.Root>
          </Thread.Messages>
        </Thread.Root>
      </ChatProvider>
    );

    const { rerender } = render(renderThread("Copy me"));

    fireEvent.click(screen.getByText("Copy"));

    await waitFor(() => {
      expect(screen.getByText("Copy").getAttribute("data-state")).toBe("copied");
    });

    rerender(renderThread("Updated copy"));

    await waitFor(() => {
      expect(screen.getByText("Copy").getAttribute("data-state")).toBe("idle");
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
});
