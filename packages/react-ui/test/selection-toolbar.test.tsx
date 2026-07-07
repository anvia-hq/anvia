import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ComposerQuote } from "../src";
import { ChatProvider, Composer, Message, SelectionToolbar, Thread } from "../src";
import { createChatController, textMessage } from "./helpers";

const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  if (originalClipboardDescriptor === undefined) {
    Reflect.deleteProperty(navigator, "clipboard");
  } else {
    Object.defineProperty(navigator, "clipboard", originalClipboardDescriptor);
  }
});

describe("SelectionToolbar primitives", () => {
  it("renders for text selected inside one message and quotes the selection", async () => {
    const onQuote = vi.fn();

    render(
      <ChatProvider
        controller={createChatController({
          messages: [textMessage("assistant_1", "assistant", "Selected text")],
        })}
      >
        <Thread.Root>
          <Thread.Messages>
            <Message.Root>
              <Message.Content>
                <Message.Parts />
              </Message.Content>
            </Message.Root>
          </Thread.Messages>
          <SelectionToolbar.Root onQuote={onQuote} />
        </Thread.Root>
      </ChatProvider>,
    );

    selectText(screen.getByText("Selected text").firstChild as Text, 0, 8);

    await waitFor(() => {
      expect(screen.getByText("Quote")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("Quote"));

    expect(onQuote).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "Selected",
        messageId: "assistant_1",
      }),
    );
    expect(screen.queryByText("Quote")).toBeNull();
  });

  it("copies selected text", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(
      <ChatProvider
        controller={createChatController({
          messages: [textMessage("assistant_1", "assistant", "Copy this")],
        })}
      >
        <Thread.Root>
          <Thread.Messages>
            <Message.Root>
              <Message.Content>
                <Message.Parts />
              </Message.Content>
            </Message.Root>
          </Thread.Messages>
          <SelectionToolbar.Root />
        </Thread.Root>
      </ChatProvider>,
    );

    selectText(screen.getByText("Copy this").firstChild as Text, 0, 4);

    await waitFor(() => {
      expect(screen.getByText("Copy")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("Copy"));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("Copy");
    });
  });

  it("ignores selections that cross messages", async () => {
    render(
      <ChatProvider
        controller={createChatController({
          messages: [
            textMessage("assistant_1", "assistant", "First message"),
            textMessage("assistant_2", "assistant", "Second message"),
          ],
        })}
      >
        <Thread.Root>
          <Thread.Messages>
            <Message.Root>
              <Message.Content>
                <Message.Parts />
              </Message.Content>
            </Message.Root>
          </Thread.Messages>
          <SelectionToolbar.Root />
        </Thread.Root>
      </ChatProvider>,
    );

    const first = screen.getByText("First message").firstChild as Text;
    const second = screen.getByText("Second message").firstChild as Text;
    const range = document.createRange();
    range.setStart(first, 0);
    range.setEnd(second, 6);
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));

    await waitFor(() => {
      expect(screen.queryByText("Quote")).toBeNull();
    });
  });

  it("bridges quoted selections into controlled composer quote state", async () => {
    const sendMessage = vi.fn(async () => {});

    function QuotedComposer() {
      const [quote, setQuote] = useState<ComposerQuote | undefined>();

      return (
        <ChatProvider
          controller={createChatController({
            sendMessage,
            messages: [textMessage("assistant_1", "assistant", "Quoted text")],
          })}
        >
          <Thread.Root>
            <Thread.Messages>
              <Message.Root>
                <Message.Content>
                  <Message.Parts />
                </Message.Content>
              </Message.Root>
            </Thread.Messages>
            <SelectionToolbar.Root onQuote={setQuote} />
            <Composer.Root quote={quote} onQuoteChange={setQuote}>
              <Composer.Quote />
              <Composer.ClearQuote />
              <Composer.Input />
              <Composer.Submit />
            </Composer.Root>
          </Thread.Root>
        </ChatProvider>
      );
    }

    render(<QuotedComposer />);

    selectText(screen.getByText("Quoted text").firstChild as Text, 0, 6);

    await waitFor(() => {
      expect(screen.getByText("Quote")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("Quote"));

    expect(screen.getByText("Quoted")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "reply" } });
    fireEvent.click(screen.getByText("Send"));

    await waitFor(() => {
      expect(sendMessage).toHaveBeenCalledWith({
        text: "> Quoted\n\nreply",
        metadata: {
          quote: {
            text: "Quoted",
            messageId: "assistant_1",
          },
        },
      });
    });
  });
});

function selectText(textNode: Text, start: number, end: number): void {
  const range = document.createRange();
  range.setStart(textNode, start);
  range.setEnd(textNode, end);
  const selection = document.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  document.dispatchEvent(new Event("selectionchange"));
}
