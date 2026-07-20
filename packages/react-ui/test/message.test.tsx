import type { UIMessage } from "@anvia/react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type ComponentProps, type ReactElement, StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChatProvider, type ComposerEntity, Message, Thread } from "../src";
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
    expect(text?.hasAttribute("data-streaming")).toBe(false);
    expect(raf.request).not.toHaveBeenCalled();
  });

  it("uses smoothed text when Message.Text receives a stream lifecycle", () => {
    const raf = installAnimationFrame();
    const props = { stream: { isStreaming: true, resetKey: "msg_1" } };
    const { container, rerender } = render(textView("Hello", props));

    rerender(textView("Hello world", props));

    const text = container.querySelector("[data-anvia-text]");
    expect(text?.textContent).toBe("Hello");
    expect(text?.hasAttribute("data-streaming")).toBe(true);

    act(() => raf.advance(230));

    expect(text?.textContent).not.toBe("Hello world");
    expect(text?.textContent?.startsWith("Hello")).toBe(true);

    drainAnimationFrames(raf);
    expect(text?.textContent).toBe("Hello world");
  });

  it("preserves custom Message.Text children when streaming is enabled", () => {
    const raf = installAnimationFrame();
    const props = {
      children: "Custom content",
      stream: { isStreaming: true, resetKey: "msg_1" },
    };
    const { container, rerender } = render(textView("Hello", props));

    rerender(textView("Hello world", props));

    expect(container.querySelector("[data-anvia-text]")?.textContent).toBe("Custom content");
    expect(raf.request).not.toHaveBeenCalled();
  });

  it("delays a later tool until parent-controlled text finishes", () => {
    const raf = installAnimationFrame();
    const stream = { isStreaming: true, resetKey: "msg_1" };
    const initial = textMessage("msg_1", "assistant", "A");
    const next: UIMessage = {
      ...initial,
      parts: [
        { id: initial.parts[0]?.id ?? "text_1", type: "text", text: "Text before the tool" },
        {
          id: "tool_1",
          type: "tool",
          toolCallId: "call_1",
          toolName: "search",
          state: "input-available",
        },
      ],
    };
    const { container, rerender } = render(partsStreamView(initial, stream));

    rerender(partsStreamView(next, stream));
    expect(container.querySelector("[data-anvia-tool]")).toBeNull();

    act(() => raf.advance(230));
    expect(container.querySelector("[data-anvia-tool]")).toBeNull();

    drainAnimationFrames(raf);
    expect(container.querySelector("[data-anvia-tool]")).not.toBeNull();
    expect(
      container.querySelector("[data-anvia-message-parts]")?.hasAttribute("data-streaming"),
    ).toBe(true);
  });

  it("does not let a filtered reasoning part delay a visible tool", () => {
    installAnimationFrame();
    const stream = { isStreaming: true, resetKey: "msg_1" };
    const initial: UIMessage = {
      id: "msg_1",
      role: "assistant",
      parts: [{ id: "reasoning_1", type: "reasoning", text: "A" }],
    };
    const next: UIMessage = {
      ...initial,
      parts: [
        { id: "reasoning_1", type: "reasoning", text: "Reasoning still being revealed" },
        {
          id: "tool_1",
          type: "tool",
          toolCallId: "call_1",
          toolName: "search",
          state: "input-available",
        },
      ],
    };
    const filter = (part: UIMessage["parts"][number]) => part.type !== "reasoning";
    const { container, rerender } = render(partsStreamView(initial, stream, filter));

    rerender(partsStreamView(next, stream, filter));

    expect(container.querySelector("[data-anvia-tool]")).not.toBeNull();
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

  it("renders valid Composer entities as semantic Markdown markup", () => {
    const text = "See @Guide.pdf for details.";
    const entity = composerEntity(text, "@Guide.pdf", "document-1");
    const { container } = render(<StrictMode>{markdownEntityView(text, [entity])}</StrictMode>);

    const element = container.querySelector("[data-anvia-message-entity]");
    expect(element?.textContent).toBe("@Guide.pdf");
    expect(element?.getAttribute("data-entity-id")).toBe("document-1");
    expect(element?.getAttribute("data-trigger-id")).toBe("documents");
    expect(element?.hasAttribute("data-anvia-entity-index")).toBe(false);
    expect(container.querySelectorAll("[data-anvia-message-entity]")).toHaveLength(1);
  });

  it("renders multiple and adjacent entities without changing normal Markdown links", () => {
    const text =
      "See @One.pdf and [the guide](https://example.test/guide), then @Two.pdf@Three.pdf.";
    const entities = [
      composerEntity(text, "@One.pdf", "document-1"),
      composerEntity(text, "@Two.pdf", "document-2"),
      composerEntity(text, "@Three.pdf", "document-3"),
    ];
    const { container } = render(markdownEntityView(text, entities));

    expect(
      [...container.querySelectorAll("[data-anvia-message-entity]")].map(
        (element) => element.textContent,
      ),
    ).toEqual(["@One.pdf", "@Two.pdf", "@Three.pdf"]);
    expect(container.querySelector("a")?.getAttribute("href")).toBe("https://example.test/guide");
    expect(container.querySelector("a")?.textContent).toBe("the guide");
  });

  it("renders Markdown punctuation inside entity text literally", () => {
    const entityText = "@Guide[1]*draft*_copy_`v2`.pdf";
    const text = `Open ${entityText} now.`;
    const { container } = render(
      markdownEntityView(text, [composerEntity(text, entityText, "document-1")]),
    );

    const element = container.querySelector("[data-anvia-message-entity]");
    expect(element?.textContent).toBe(entityText);
    expect(element?.querySelector("em, code, a")).toBeNull();
    expect(container.querySelector("[data-anvia-markdown]")?.textContent).toBe(text);
  });

  it("keeps escaped and Unicode text aligned with UTF-16 entity offsets", () => {
    const text = String.raw`Escaped \*literal\* 👋 before @文档.pdf.`;
    const entity = composerEntity(text, "@文档.pdf", "document-unicode");
    const { container } = render(markdownEntityView(text, [entity]));

    expect(container.querySelector("[data-anvia-message-entity]")?.textContent).toBe("@文档.pdf");
    expect(container.querySelector("[data-anvia-markdown]")?.textContent).toBe(
      "Escaped *literal* 👋 before @文档.pdf.",
    );
    expect(() => JSON.stringify(entity.data)).not.toThrow();
  });

  it("renders entities only in eligible prose positions", () => {
    const text = [
      "**@Strong.pdf**",
      "",
      "`@Inline.pdf`",
      "",
      "```txt",
      "@Fenced.pdf",
      "```",
      "",
      "[@Label.pdf](https://example.test)",
      "",
      "[destination](@Destination.pdf)",
      "",
      "# @Heading.pdf",
      "",
      "- @List.pdf",
      "",
      "> @Quote.pdf",
      "",
      "| Document |",
      "| --- |",
      "| @Table.pdf |",
    ].join("\n");
    const entityTexts = [
      "@Strong.pdf",
      "@Inline.pdf",
      "@Fenced.pdf",
      "@Label.pdf",
      "@Destination.pdf",
      "@Heading.pdf",
      "@List.pdf",
      "@Quote.pdf",
      "@Table.pdf",
    ];
    const entities = entityTexts.map((entityText, index) =>
      composerEntity(text, entityText, `document-${index + 1}`),
    );
    const { container } = render(markdownEntityView(text, entities));

    const rendered = [...container.querySelectorAll("[data-anvia-message-entity]")].map(
      (element) => element.textContent,
    );
    expect(rendered).toEqual([
      "@Strong.pdf",
      "@Label.pdf",
      "@Heading.pdf",
      "@List.pdf",
      "@Quote.pdf",
      "@Table.pdf",
    ]);
    expect(container.querySelector("strong [data-anvia-message-entity]")).toBeTruthy();
    expect(container.querySelector("a [data-anvia-message-entity]")?.textContent).toBe(
      "@Label.pdf",
    );
    expect(container.querySelector("code")?.textContent).toBe("@Inline.pdf");
    expect(container.querySelector('a[href="@Destination.pdf"]')?.textContent).toBe("destination");
  });

  it("falls back to ordinary text for malformed, stale, and overlapping entities", () => {
    const text = "@One.pdf @Two.pdf";
    const overlapping = composerEntity(text, text, "overlap-all", 0);
    const second = composerEntity(text, "@Two.pdf", "overlap-second");
    const malformed: ComposerEntity[] = [
      overlapping,
      second,
      { ...composerEntity(text, "@One.pdf", "stale"), text: "@Stale.pdf" },
      { ...composerEntity(text, "@One.pdf", "out-of-bounds"), range: { from: 0, to: 999 } },
      { ...composerEntity(text, "@One.pdf", "fractional"), range: { from: 0.5, to: 8 } },
      { ...composerEntity(text, "@One.pdf", ""), id: "" },
    ];
    const { container } = render(markdownEntityView(text, malformed));

    expect(container.querySelector("[data-anvia-message-entity]")).toBeNull();
    expect(container.querySelector("[data-anvia-markdown]")?.textContent).toBe(text);
  });

  it("supports renderEntity and components.span overrides", () => {
    const text = "See @Guide.pdf.";
    const entity = composerEntity(text, "@Guide.pdf", "document-1");
    const custom = render(
      markdownEntityView(text, [entity], {
        renderEntity(current) {
          return <mark data-testid="custom-entity">{current.label}</mark>;
        },
      }),
    );
    expect(screen.getByTestId("custom-entity").textContent).toBe("Guide.pdf");
    expect(custom.container.querySelector("[data-anvia-message-entity]")).toBeNull();
    custom.unmount();

    const span = render(
      markdownEntityView(text, [entity], {
        components: {
          span({ node: _node, ...props }) {
            return <span {...props} data-testid="custom-span" />;
          },
        },
      }),
    );
    const element = screen.getByTestId("custom-span");
    expect(element.getAttribute("data-entity-id")).toBe("document-1");
    expect(element.textContent).toBe("@Guide.pdf");
    span.unmount();
  });

  it("maps message-level entity offsets across multiple text parts", () => {
    const first = "First paragraph.";
    const second = "Open @Guide.pdf.";
    const joined = `${first}\n\n${second}`;
    const entity = composerEntity(joined, "@Guide.pdf", "document-1");
    const message: UIMessage = {
      id: "msg_1",
      role: "user",
      parts: [
        { id: "part_1", type: "text", text: first },
        { id: "part_2", type: "text", text: second },
      ],
      metadata: { composer: { entities: [entity] } },
    };
    const { container } = render(
      <ChatProvider controller={createChatController({ messages: [message] })}>
        <Thread.Root>
          <Thread.Messages>
            <Message.Root>
              <Message.Markdown />
            </Message.Root>
          </Thread.Messages>
        </Thread.Root>
      </ChatProvider>,
    );

    expect(container.querySelectorAll("p")).toHaveLength(2);
    expect(container.querySelector("[data-anvia-message-entity]")?.textContent).toBe("@Guide.pdf");
  });

  it("runs the entity transform before consumer remark plugins", () => {
    const text = "See @Guide.pdf.";
    const entity = composerEntity(text, "@Guide.pdf", "document-1");
    const visitedTypes: string[] = [];

    function inspectPlugin() {
      return (tree: unknown) => collectNodeTypes(tree, visitedTypes);
    }

    render(markdownEntityView(text, [entity], { remarkPlugins: [inspectPlugin] }));
    expect(visitedTypes).toContain("messageEntity");
  });

  it("lets consumer remark plugins reconstruct entity nodes as exact text", () => {
    const entityText = "@Guide[1]*draft*.pdf";
    const text = `Open ${entityText}.`;

    function literalizePlugin() {
      return (tree: unknown) => literalizeEntityNodes(tree);
    }

    const { container } = render(
      markdownEntityView(text, [composerEntity(text, entityText, "document-1")], {
        remarkPlugins: [literalizePlugin],
      }),
    );
    expect(container.querySelector("[data-anvia-message-entity]")).toBeNull();
    expect(container.querySelector("[data-anvia-markdown]")?.textContent).toBe(text);
  });

  it("keeps copy and regenerate disabled for standalone tool messages", () => {
    const toolMessage: UIMessage = {
      id: "tool_message_1",
      role: "tool",
      parts: [
        {
          id: "tool_1",
          type: "tool",
          toolName: "lookup",
          toolCallId: "tool_1",
          state: "output-available",
          input: { query: "Anvia" },
          output: "done",
        },
      ],
      metadata: { source: "tool" },
    };
    render(
      <ChatProvider controller={createChatController({ messages: [toolMessage] })}>
        <Thread.Root>
          <Thread.Messages>
            <Message.Root>
              <Message.Copy />
              <Message.Regenerate />
            </Message.Root>
          </Thread.Messages>
        </Thread.Root>
      </ChatProvider>,
    );

    expect((screen.getByText("Copy") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText("Regenerate") as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps Message.Markdown rendering immediate by default", () => {
    const raf = installAnimationFrame();
    const { container, rerender } = render(markdownView("Hello"));

    rerender(markdownView("Hello **world**"));

    const markdown = container.querySelector("[data-anvia-markdown]");
    expect(markdown?.textContent).toBe("Hello world");
    expect(markdown?.querySelector("strong")?.textContent).toBe("world");
    expect(markdown?.hasAttribute("data-streaming")).toBe(false);
    expect(raf.request).not.toHaveBeenCalled();
  });

  it("uses smoothed markdown text and a live-tail reveal while streaming", () => {
    const raf = installAnimationFrame();
    const props = {
      stream: { isStreaming: true, resetKey: "msg_1" },
    };
    const { container, rerender } = render(markdownView("Hello", props));

    rerender(markdownView("Hello **world**", props));

    const markdown = container.querySelector("[data-anvia-markdown]");
    expect(markdown?.textContent).toBe("Hello");
    expect(markdown?.hasAttribute("data-streaming")).toBe(true);

    act(() => raf.advance(250));
    expect(markdown?.textContent).not.toBe("Hello world");
    expect(markdown?.querySelector("[data-anvia-stream-reveal]")).not.toBeNull();

    drainAnimationFrames(raf);
    expect(markdown?.textContent).toBe("Hello world");
    expect(markdown?.querySelector("strong")?.textContent).toBe("world");
  });

  it("preserves code block behavior after animated markdown completes", () => {
    const raf = installAnimationFrame();
    const props = { stream: { isStreaming: true, resetKey: "msg_1" } };
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

function partsStreamView(
  message: UIMessage,
  stream: NonNullable<ComponentProps<typeof Message.Parts>["stream"]>,
  filter?: ComponentProps<typeof Message.Parts>["filter"],
): ReactElement {
  return (
    <ChatProvider controller={createChatController({ messages: [message] })}>
      <Thread.Root>
        <Thread.Messages>
          <Message.Root>
            <Message.Parts {...(filter === undefined ? {} : { filter })} stream={stream} />
          </Message.Root>
        </Thread.Messages>
      </Thread.Root>
    </ChatProvider>
  );
}

function markdownEntityView(
  markdown: string,
  entities: ComposerEntity[],
  props: ComponentProps<typeof Message.Markdown> = {},
): ReactElement {
  const message = {
    ...textMessage("msg_1", "user", markdown),
    metadata: { composer: { entities } },
  };
  return (
    <ChatProvider controller={createChatController({ messages: [message] })}>
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

function composerEntity(
  text: string,
  entityText: string,
  id: string,
  from = text.indexOf(entityText),
): ComposerEntity {
  return {
    id,
    triggerId: "documents",
    trigger: "@",
    label: entityText.slice(1),
    text: entityText,
    range: { from, to: from + entityText.length },
    data: { kind: "document", documentId: id },
  };
}

function collectNodeTypes(value: unknown, types: string[]): void {
  if (typeof value !== "object" || value === null) {
    return;
  }
  if ("type" in value && typeof value.type === "string") {
    types.push(value.type);
  }
  if ("children" in value && Array.isArray(value.children)) {
    for (const child of value.children) {
      collectNodeTypes(child, types);
    }
  }
}

function literalizeEntityNodes(value: unknown): void {
  if (typeof value !== "object" || value === null) {
    return;
  }
  if ("type" in value && value.type === "messageEntity") {
    value.type = "text";
    if ("entityIndex" in value) {
      delete value.entityIndex;
    }
  }
  if ("children" in value && Array.isArray(value.children)) {
    for (const child of value.children) {
      literalizeEntityNodes(child);
    }
  }
}

function installAnimationFrame() {
  let now = 0;
  let nextId = 0;
  const callbacks = new Map<number, FrameRequestCallback>();
  vi.spyOn(performance, "now").mockImplementation(() => now);
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
    advance(durationMs: number) {
      const target = now + durationMs;
      while (callbacks.size > 0 && now < target) {
        now = Math.min(target, now + 1_000 / 60);
        const pending = [...callbacks.values()];
        callbacks.clear();
        for (const callback of pending) {
          callback(now);
        }
      }
      now = target;
    },
  };
}

function drainAnimationFrames(raf: AnimationFrameHarness): void {
  act(() => raf.advance(2_000));
  expect(raf.pending()).toBe(0);
}
