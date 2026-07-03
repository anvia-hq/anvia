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
