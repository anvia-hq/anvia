import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChatProvider, Composer, Thread } from "../src";
import { createChatController, textMessage } from "./helpers";

afterEach(() => {
  cleanup();
});

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

  it("respects prevented composer submit and supports stop", () => {
    const sendMessage = vi.fn(async () => {});
    const stop = vi.fn();

    const { rerender } = render(
      <ChatProvider controller={createChatController({ sendMessage })}>
        <Composer.Root
          aria-label="Chat form"
          onSubmit={(event) => {
            event.preventDefault();
          }}
        >
          <Composer.Input />
          <Composer.Submit />
        </Composer.Root>
      </ChatProvider>,
    );

    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "blocked" } });
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

  it("submits composer input from Enter and ignores modified Enter", () => {
    const sendMessage = vi.fn(async () => {});

    render(
      <ChatProvider controller={createChatController({ sendMessage })}>
        <Composer.Root>
          <Composer.Input />
        </Composer.Root>
      </ChatProvider>,
    );

    const input = screen.getByLabelText("Message");
    fireEvent.change(input, { target: { value: "hello" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith("hello");
  });
});
