import type { UIAttachment } from "@anvia/react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ComposerEntity, ComposerSubmitMessage, ComposerTriggerDefinition } from "../src";
import { ChatProvider, Composer, Thread, useComposer } from "../src";
import { createChatController, textMessage } from "./helpers";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function composerEditor(): HTMLElement {
  return screen.getByLabelText("Message");
}

function ComposerInputSetter({ children, value }: { children: string; value: string }) {
  const composer = useComposer();
  return (
    <button
      type="button"
      onClick={() => {
        composer.setInput(value);
      }}
    >
      {children}
    </button>
  );
}

const peopleItems = [
  {
    id: "user_ada",
    label: "Ada",
    data: { kind: "user" },
  },
];

const peopleTrigger: ComposerTriggerDefinition = {
  id: "people",
  char: "@",
  items: peopleItems,
};

function ComposerTriggerOpener() {
  const composer = useComposer();
  const entity: ComposerEntity = {
    id: "user_ada",
    triggerId: "people",
    trigger: "@",
    label: "Ada",
    text: "@Ada",
    range: { from: 0, to: 4 },
    data: { kind: "user" },
  };
  return (
    <button
      type="button"
      onClick={() => {
        composer.setActiveTrigger({
          trigger: peopleTrigger,
          query: "a",
          items: peopleItems,
          loading: false,
          selectedIndex: 0,
          selectItem: () => {
            composer.setInput("@Ada");
            composer.setEntities([entity]);
            composer.setActiveTrigger(undefined);
          },
          setSelectedIndex: (index) => {
            composer.setActiveTrigger((active) =>
              active === undefined ? active : { ...active, selectedIndex: index },
            );
          },
        });
      }}
    >
      Open people
    </button>
  );
}

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
        <Composer.Root aria-label="Chat form" defaultInput="hello">
          <Composer.Input />
          <Composer.Submit asChild>
            <button data-testid="send" type="submit">
              Send
            </button>
          </Composer.Submit>
        </Composer.Root>
      </ChatProvider>,
    );

    const button = screen.getByTestId("send");
    expect(button.getAttribute("data-anvia-submit")).toBe("");

    fireEvent.click(button);

    expect(sendMessage).toHaveBeenCalledWith("hello");
  });

  it("submits quote-only composer messages", async () => {
    const sendMessage = vi.fn(async () => {});
    const quote = { text: "Quoted text", messageId: "assistant_1" };

    render(
      <ChatProvider controller={createChatController({ sendMessage })}>
        <Composer.Root defaultQuote={quote}>
          <Composer.Quote />
          <Composer.Submit />
        </Composer.Root>
      </ChatProvider>,
    );

    fireEvent.click(screen.getByText("Send"));

    await waitFor(() => {
      expect(sendMessage).toHaveBeenCalledWith({
        text: "> Quoted text",
        metadata: { quote },
      });
    });
    expect(screen.queryByText("Quoted text")).toBeNull();
  });

  it("renders thread defaults and updates scroll state", () => {
    const scrollTo = vi.fn();
    const onScroll = vi.fn();

    render(
      <ChatProvider
        controller={createChatController({
          messages: [textMessage("assistant_1", "assistant", "Hello")],
        })}
      >
        <Thread.Root>
          <Thread.Viewport
            data-testid="viewport"
            onScroll={onScroll}
            ref={(node) => {
              if (node === null) {
                return;
              }
              Object.defineProperties(node, {
                clientHeight: { configurable: true, value: 20 },
                scrollHeight: { configurable: true, value: 100 },
                scrollTo: { configurable: true, value: scrollTo },
              });
            }}
          >
            <Thread.Empty data-testid="empty">Empty</Thread.Empty>
            <Thread.Messages />
            <Thread.ScrollToBottom />
          </Thread.Viewport>
        </Thread.Root>
      </ChatProvider>,
    );

    expect(screen.queryByTestId("empty")).toBeNull();
    expect(screen.getByText("Hello")).toBeTruthy();
    expect(screen.getByText("Copy")).toBeTruthy();
    expect(scrollTo).toHaveBeenCalledWith({ top: 100, behavior: "auto" });

    const viewport = screen.getByTestId("viewport");
    Object.defineProperty(viewport, "scrollTop", { configurable: true, value: 0 });
    fireEvent.scroll(viewport);

    const scrollButton = screen.getByText("Scroll to bottom") as HTMLButtonElement;
    expect(onScroll).toHaveBeenCalledTimes(1);
    expect(scrollButton.disabled).toBe(false);

    fireEvent.click(scrollButton);

    expect(scrollTo).toHaveBeenLastCalledWith({ top: 100, behavior: "smooth" });
  });

  it("renders status, loading, error, and suggestions", () => {
    const sendMessage = vi.fn(async () => {});

    const { rerender } = render(
      <ChatProvider
        controller={createChatController({
          sendMessage,
          status: "streaming",
          suggestions: [{ id: "s1", prompt: "Summarize", label: "Summarize this" }],
        })}
      >
        <Thread.Root>
          <Thread.Status />
          <Thread.Loading />
          <Thread.Error />
          <Thread.Suggestions />
        </Thread.Root>
      </ChatProvider>,
    );

    expect(screen.getByText("streaming")).toBeTruthy();
    expect(screen.getByText("Loading")).toBeTruthy();
    expect((screen.getByText("Summarize this") as HTMLButtonElement).disabled).toBe(true);

    rerender(
      <ChatProvider
        controller={createChatController({
          sendMessage,
          status: "error",
          error: new Error("Request failed"),
          suggestions: [{ id: "s1", prompt: "Summarize", label: "Summarize this" }],
        })}
      >
        <Thread.Root>
          <Thread.Status />
          <Thread.Loading />
          <Thread.Error />
          <Thread.Suggestions />
        </Thread.Root>
      </ChatProvider>,
    );

    expect(screen.queryByText("Loading")).toBeNull();
    expect(screen.getByText("Request failed")).toBeTruthy();
    fireEvent.click(screen.getByText("Summarize this"));

    expect(sendMessage).toHaveBeenCalledWith("Summarize");
  });

  it("controls optional thread collection wrappers with keepMounted", () => {
    const { container } = render(
      <ChatProvider controller={createChatController()}>
        <Thread.Root>
          <Thread.Messages data-testid="messages" />
          <Thread.Messages data-testid="messages-unmounted" keepMounted={false} />
          <Thread.Suggestions data-testid="suggestions" />
          <Thread.Suggestions data-testid="suggestions-mounted" keepMounted />
        </Thread.Root>
      </ChatProvider>,
    );

    expect(screen.getByTestId("messages").getAttribute("data-empty")).toBe("");
    expect(screen.queryByTestId("messages-unmounted")).toBeNull();
    expect(screen.queryByTestId("suggestions")).toBeNull();
    expect(screen.getByTestId("suggestions-mounted").getAttribute("data-empty")).toBe("");
    expect(container.querySelector("[data-anvia-thread-suggestions]")).toBeTruthy();
  });

  it("adds file attachments and submits them with composer input", async () => {
    const sendMessage = vi.fn(async () => {});
    const file = new File(["hello"], "hello.txt", { type: "text/plain" });

    const { container } = render(
      <ChatProvider controller={createChatController({ sendMessage })}>
        <Composer.Root defaultInput="read this">
          <Composer.AddAttachment />
          <Composer.Attachments />
          <Composer.Input />
          <Composer.Submit />
        </Composer.Root>
      </ChatProvider>,
    );

    expect(container.querySelector("[data-anvia-composer-attachments]")).toBeNull();

    const input = container.querySelector("[data-anvia-attachment-input]");
    expect(input).toBeInstanceOf(HTMLInputElement);
    fireEvent.change(input as HTMLInputElement, { target: { files: [file] } });

    await waitFor(() => {
      expect(container.querySelector("[data-anvia-composer-attachments]")).toBeInstanceOf(
        HTMLDivElement,
      );
      expect(screen.getByText("hello.txt")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("Send"));

    await waitFor(() => {
      expect(sendMessage).toHaveBeenCalledWith({
        text: "read this",
        attachments: [
          expect.objectContaining({
            type: "document",
            name: "hello.txt",
            mediaType: "text/plain",
          }),
        ],
      });
    });

    await waitFor(() => {
      expect(container.querySelector("[data-anvia-composer-attachments]")).toBeNull();
    });
  });

  it("supports controlled composer input and attachments", async () => {
    const sendMessage = vi.fn(async () => {});
    const onInputChange = vi.fn();
    const onAttachmentsChange = vi.fn();
    const file = new File(["hello"], "controlled.txt", { type: "text/plain" });

    function ControlledComposer() {
      const [input, setInput] = useState("draft");
      const [attachments, setAttachments] = useState<UIAttachment[]>([]);

      return (
        <ChatProvider controller={createChatController({ sendMessage })}>
          <Composer.Root
            attachments={attachments}
            input={input}
            onAttachmentsChange={(nextAttachments) => {
              onAttachmentsChange(nextAttachments);
              setAttachments(nextAttachments);
            }}
            onInputChange={(nextInput) => {
              onInputChange(nextInput);
              setInput(nextInput);
            }}
          >
            <Composer.Attachments />
            <Composer.AttachmentInput data-testid="attachment-input" />
            <Composer.Input />
            <ComposerInputSetter value="controlled">Set controlled</ComposerInputSetter>
            <Composer.Submit />
          </Composer.Root>
        </ChatProvider>
      );
    }

    render(<ControlledComposer />);

    const input = composerEditor();
    expect(input.textContent).toBe("draft");
    fireEvent.click(screen.getByText("Set controlled"));

    expect(onInputChange).toHaveBeenCalledWith("controlled");

    fireEvent.change(screen.getByTestId("attachment-input"), { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText("controlled.txt")).toBeTruthy();
    });

    expect(onAttachmentsChange).toHaveBeenLastCalledWith([
      expect.objectContaining({
        type: "document",
        name: "controlled.txt",
        mediaType: "text/plain",
      }),
    ]);

    fireEvent.click(screen.getByText("Send"));

    await waitFor(() => {
      expect(sendMessage).toHaveBeenCalledWith({
        text: "controlled",
        attachments: [
          expect.objectContaining({
            type: "document",
            name: "controlled.txt",
          }),
        ],
      });
    });
    expect(onInputChange).toHaveBeenLastCalledWith("");
    expect(onAttachmentsChange).toHaveBeenLastCalledWith([]);
  });

  it("renders trigger menu items and submits selected entities as metadata", async () => {
    const sendMessage = vi.fn(async () => {});

    render(
      <ChatProvider controller={createChatController({ sendMessage })}>
        <Composer.Root triggers={[peopleTrigger]}>
          <Composer.Input />
          <ComposerTriggerOpener />
          <Composer.TriggerMenu />
          <Composer.Submit />
        </Composer.Root>
      </ChatProvider>,
    );

    fireEvent.click(screen.getByText("Open people"));

    const item = screen.getByText("Ada");
    expect(item.getAttribute("data-anvia-composer-trigger-item")).toBe("");
    fireEvent.click(item);
    fireEvent.click(screen.getByText("Send"));

    await waitFor(() => {
      expect(sendMessage).toHaveBeenCalledWith({
        text: "@Ada",
        metadata: {
          composer: {
            entities: [
              {
                id: "user_ada",
                triggerId: "people",
                trigger: "@",
                label: "Ada",
                text: "@Ada",
                range: { from: 0, to: 4 },
                data: { kind: "user" },
              },
            ],
          },
        },
      });
    });
  });

  it("keeps trigger menu mounted with render children while inactive", () => {
    render(
      <ChatProvider controller={createChatController()}>
        <Composer.Root triggers={[peopleTrigger]}>
          <Composer.TriggerMenu keepMounted data-testid="trigger-menu">
            {() => <span>Active trigger</span>}
          </Composer.TriggerMenu>
        </Composer.Root>
      </ChatProvider>,
    );

    const menu = screen.getByTestId("trigger-menu");
    expect(menu.getAttribute("data-empty")).toBe("");
    expect(menu.textContent).toBe("");
  });

  it("supports custom composer submit from form submit and Enter", async () => {
    const sendMessage = vi.fn(async () => {});
    const attachment: UIAttachment = {
      id: "attachment_1",
      type: "document",
      name: "notes.txt",
      mediaType: "text/plain",
      data: "hello",
    };
    const submitMessage = vi.fn<ComposerSubmitMessage>(
      async ({ input, attachments, chat, clear }) => {
        await chat.sendMessage({
          text: input,
          attachments,
          metadata: { source: "custom" },
        });
        clear();
      },
    );

    const { container } = render(
      <ChatProvider controller={createChatController({ sendMessage })}>
        <Composer.Root
          defaultAttachments={[attachment]}
          defaultInput="button"
          submitMessage={submitMessage}
        >
          <Composer.Attachments />
          <Composer.Input />
          <ComposerInputSetter value="enter">Set enter</ComposerInputSetter>
          <Composer.Submit />
        </Composer.Root>
      </ChatProvider>,
    );

    fireEvent.click(screen.getByText("Send"));

    await waitFor(() => {
      expect(submitMessage).toHaveBeenCalledTimes(1);
    });
    expect(submitMessage.mock.calls[0]?.[0]).toMatchObject({
      input: "button",
      attachments: [attachment],
      chat: expect.objectContaining({ sendMessage }),
    });
    expect(typeof submitMessage.mock.calls[0]?.[0].clear).toBe("function");
    expect(sendMessage).toHaveBeenNthCalledWith(1, {
      text: "button",
      attachments: [attachment],
      metadata: { source: "custom" },
    });

    await waitFor(() => {
      expect(composerEditor().textContent).toBe("");
    });
    expect(container.querySelector("[data-anvia-composer-attachments]")).toBeNull();

    fireEvent.click(screen.getByText("Set enter"));
    fireEvent.keyDown(composerEditor(), { key: "Enter" });

    await waitFor(() => {
      expect(submitMessage).toHaveBeenCalledTimes(2);
    });
    expect(sendMessage).toHaveBeenNthCalledWith(2, {
      text: "enter",
      attachments: [],
      metadata: { source: "custom" },
    });
  });

  it("lets custom composer submit control when state is cleared", async () => {
    const attachment: UIAttachment = {
      id: "attachment_1",
      type: "document",
      name: "controlled.txt",
      mediaType: "text/plain",
      data: "hello",
    };
    const submitMessage = vi.fn<ComposerSubmitMessage>(async () => {});

    function ControlledComposer() {
      const [input, setInput] = useState("draft");
      const [attachments, setAttachments] = useState<UIAttachment[]>([attachment]);

      return (
        <ChatProvider controller={createChatController()}>
          <Composer.Root
            attachments={attachments}
            input={input}
            onAttachmentsChange={setAttachments}
            onInputChange={setInput}
            submitMessage={submitMessage}
          >
            <Composer.Attachments />
            <Composer.Input />
            <Composer.Submit />
          </Composer.Root>
        </ChatProvider>
      );
    }

    render(<ControlledComposer />);

    fireEvent.click(screen.getByText("Send"));

    await waitFor(() => {
      expect(submitMessage).toHaveBeenCalledTimes(1);
    });
    expect(composerEditor().textContent).toBe("draft");
    expect(screen.getByText("controlled.txt")).toBeTruthy();

    submitMessage.mockImplementationOnce(async ({ clear }) => {
      clear();
    });
    fireEvent.click(screen.getByText("Send"));

    await waitFor(() => {
      expect(composerEditor().textContent).toBe("");
    });
    expect(screen.queryByText("controlled.txt")).toBeNull();
  });

  it("does not call custom composer submit when empty or streaming", () => {
    const submitMessage = vi.fn<ComposerSubmitMessage>(async () => {});
    const { rerender } = render(
      <ChatProvider controller={createChatController()}>
        <Composer.Root aria-label="Chat form" submitMessage={submitMessage}>
          <Composer.Input />
          <Composer.Submit />
        </Composer.Root>
      </ChatProvider>,
    );

    fireEvent.submit(screen.getByLabelText("Chat form"));

    expect(submitMessage).not.toHaveBeenCalled();

    rerender(
      <ChatProvider controller={createChatController({ status: "streaming" })}>
        <Composer.Root aria-label="Chat form" input="busy" submitMessage={submitMessage}>
          <Composer.Input />
          <Composer.Submit />
        </Composer.Root>
      </ChatProvider>,
    );

    fireEvent.submit(screen.getByLabelText("Chat form"));

    expect(submitMessage).not.toHaveBeenCalled();
  });

  it("respects prevented composer submit and supports stop", () => {
    const sendMessage = vi.fn(async () => {});
    const stop = vi.fn();

    const { rerender } = render(
      <ChatProvider controller={createChatController({ sendMessage })}>
        <Composer.Root
          aria-label="Chat form"
          defaultInput="blocked"
          onSubmit={(event) => {
            event.preventDefault();
          }}
        >
          <Composer.Input />
          <Composer.Submit />
        </Composer.Root>
      </ChatProvider>,
    );

    fireEvent.submit(screen.getByLabelText("Chat form"));

    expect(sendMessage).not.toHaveBeenCalled();

    rerender(
      <ChatProvider controller={createChatController({ status: "streaming", stop })}>
        <Composer.Root>
          <Composer.Stop />
        </Composer.Root>
      </ChatProvider>,
    );

    fireEvent.click(screen.getByText("Stop"));

    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("submits composer input from Enter", async () => {
    const sendMessage = vi.fn(async () => {});

    render(
      <ChatProvider controller={createChatController({ sendMessage })}>
        <Composer.Root defaultInput="hello">
          <Composer.Input />
        </Composer.Root>
      </ChatProvider>,
    );

    await waitFor(() => {
      expect(composerEditor().textContent).toBe("hello");
    });
    const input = composerEditor();
    fireEvent.keyDown(input, { code: "Enter", key: "Enter", keyCode: 13 });

    await waitFor(() => {
      expect(sendMessage).toHaveBeenCalledTimes(1);
    });
    expect(sendMessage).toHaveBeenCalledWith("hello");
  });

  it("auto-resizes composer input up to the configured max rows", () => {
    const computedStyle = vi.spyOn(window, "getComputedStyle").mockReturnValue({
      borderBottomWidth: "1px",
      borderTopWidth: "1px",
      boxSizing: "border-box",
      fontSize: "16px",
      lineHeight: "20px",
      paddingBottom: "4px",
      paddingTop: "4px",
    } as CSSStyleDeclaration);
    let scrollHeight = 48;

    render(
      <ChatProvider controller={createChatController()}>
        <Composer.Root>
          <Composer.TextareaInput
            maxRows={3}
            minRows={2}
            ref={(node) => {
              if (node === null) {
                return;
              }
              Object.defineProperty(node, "scrollHeight", {
                configurable: true,
                get: () => scrollHeight,
              });
            }}
          />
        </Composer.Root>
      </ChatProvider>,
    );

    const input = screen.getByLabelText("Message") as HTMLTextAreaElement;
    expect(input.getAttribute("rows")).toBe("2");
    expect(input.style.height).toBe("50px");
    expect(input.style.overflowY).toBe("hidden");

    scrollHeight = 96;
    fireEvent.change(input, { target: { value: "one\ntwo\nthree\nfour" } });

    expect(input.style.height).toBe("70px");
    expect(input.style.overflowY).toBe("auto");
    expect(computedStyle).toHaveBeenCalled();
  });
});
