import type { UIMessage } from "@anvia/react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps, ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChatProvider, Message, Thread } from "../src";
import { createChatController, textMessage } from "./helpers";

const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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

  it("keeps Message.Text rendering immediate by default", () => {
    const raf = installAnimationFrame();
    const { container, rerender } = render(textView("Hello"));

    rerender(textView("Hello world"));

    const text = container.querySelector("[data-anvia-text]");
    expect(text?.textContent).toBe("Hello world");
    expect(text?.hasAttribute("data-anvia-stream-animation")).toBe(false);
    expect(raf.request).not.toHaveBeenCalled();
  });

  it("uses smoothed text when Message.Text animation is enabled", () => {
    const raf = installAnimationFrame();
    const props = { animate: true, isStreaming: true, reducedMotion: false };
    const { container, rerender } = render(textView("Hello", props));

    rerender(textView("Hello world", props));

    const text = container.querySelector("[data-anvia-text]");
    expect(text?.textContent).toBe("Hello");
    expect(text?.getAttribute("data-anvia-stream-animation")).toBe("smooth");

    actAnimationFrame(raf);

    expect(text?.textContent).not.toBe("Hello world");
    expect(text?.textContent?.startsWith("Hello")).toBe(true);

    drainAnimationFrames(raf);
    expect(text?.textContent).toBe("Hello world");
  });

  it("preserves custom Message.Text children when animation is enabled", () => {
    const raf = installAnimationFrame();
    const props = {
      animate: true,
      children: "Custom content",
      isStreaming: true,
      reducedMotion: false,
    };
    const { container, rerender } = render(textView("Hello", props));

    rerender(textView("Hello world", props));

    expect(container.querySelector("[data-anvia-text]")?.textContent).toBe("Custom content");
    expect(raf.request).not.toHaveBeenCalled();
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

  it("keeps Message.Markdown rendering immediate by default", () => {
    const raf = installAnimationFrame();
    const { container, rerender } = render(markdownView("Hello"));

    rerender(markdownView("Hello **world**"));

    const markdown = container.querySelector("[data-anvia-markdown]");
    expect(markdown?.textContent).toBe("Hello world");
    expect(markdown?.querySelector("strong")?.textContent).toBe("world");
    expect(markdown?.hasAttribute("data-anvia-stream-animation")).toBe(false);
    expect(raf.request).not.toHaveBeenCalled();
  });

  it("uses smoothed markdown text and fade-in attributes when enabled", () => {
    const raf = installAnimationFrame();
    const props = {
      animate: true,
      animationMode: "fadeIn" as const,
      isStreaming: true,
      reducedMotion: false,
    };
    const { container, rerender } = render(markdownView("Hello", props));

    rerender(markdownView("Hello **world**", props));

    const markdown = container.querySelector("[data-anvia-markdown]");
    expect(markdown?.textContent).toBe("Hello");
    expect(markdown?.getAttribute("data-anvia-stream-animation")).toBe("fadeIn");
    expect(markdown?.hasAttribute("data-streaming")).toBe(true);

    actAnimationFrame(raf);
    expect(markdown?.textContent).not.toBe("Hello world");

    drainAnimationFrames(raf);
    expect(markdown?.textContent).toBe("Hello world");
    expect(markdown?.querySelector("strong")?.textContent).toBe("world");
  });

  it("preserves code block behavior after animated markdown completes", () => {
    const raf = installAnimationFrame();
    const props = { animate: true, isStreaming: true, reducedMotion: false };
    const { container, rerender } = render(markdownView("Code:\n\n", props));

    rerender(markdownView("Code:\n\n```ts\nconst ok = true;\n```", props));
    drainAnimationFrames(raf);

    expect(container.querySelectorAll("[data-anvia-code-block]")).toHaveLength(1);
    expect(container.querySelector("[data-anvia-code-block] pre")).toBeNull();
    expect(screen.getByText("const ok = true;")).toBeTruthy();
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

type AnimationFrameHarness = ReturnType<typeof installAnimationFrame>;

function textView(text: string, props: ComponentProps<typeof Message.Text> = {}): ReactElement {
  return (
    <ChatProvider
      controller={createChatController({ messages: [textMessage("msg_1", "assistant", text)] })}
    >
      <Thread.Root>
        <Thread.Messages>
          <Message.Root>
            <Message.Content>
              <Message.Parts>
                <Message.Part>
                  <Message.Text {...props} />
                </Message.Part>
              </Message.Parts>
            </Message.Content>
          </Message.Root>
        </Thread.Messages>
      </Thread.Root>
    </ChatProvider>
  );
}

function markdownView(
  markdown: string,
  props: ComponentProps<typeof Message.Markdown> = {},
): ReactElement {
  return (
    <ChatProvider
      controller={createChatController({
        messages: [textMessage("msg_1", "assistant", markdown)],
      })}
    >
      <Thread.Root>
        <Thread.Messages>
          <Message.Root>
            <Message.Markdown {...props} />
          </Message.Root>
        </Thread.Messages>
      </Thread.Root>
    </ChatProvider>
  );
}

function installAnimationFrame() {
  let nextId = 0;
  const callbacks = new Map<number, FrameRequestCallback>();
  const request = vi.fn((callback: FrameRequestCallback) => {
    const id = ++nextId;
    callbacks.set(id, callback);
    return id;
  });
  const cancel = vi.fn((id: number) => {
    callbacks.delete(id);
  });

  vi.stubGlobal("requestAnimationFrame", request);
  vi.stubGlobal("cancelAnimationFrame", cancel);

  return {
    cancel,
    pending: () => callbacks.size,
    request,
    step() {
      const pending = [...callbacks.values()];
      callbacks.clear();
      for (const callback of pending) {
        callback(0);
      }
    },
  };
}

function actAnimationFrame(raf: AnimationFrameHarness): void {
  act(() => raf.step());
}

function drainAnimationFrames(raf: AnimationFrameHarness): void {
  for (let frame = 0; frame < 100 && raf.pending() > 0; frame += 1) {
    actAnimationFrame(raf);
  }
  expect(raf.pending()).toBe(0);
}
