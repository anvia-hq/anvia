import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  Attachment,
  ChatProvider,
  Completion,
  CompletionProvider,
  Composer,
  HumanInput,
  Message,
  Thread,
} from "../src";
import { stringifyValue } from "../src/format";
import { composeRefs } from "../src/primitives";
import { createChatController, createCompletionController } from "./helpers";

describe("shared internals", () => {
  it("composes callback and object refs", () => {
    const callbackRef = vi.fn();
    const objectRef = { current: null as HTMLDivElement | null };
    const node = document.createElement("div");

    composeRefs<HTMLDivElement>(callbackRef, objectRef, undefined)(node);

    expect(callbackRef).toHaveBeenCalledWith(node);
    expect(objectRef.current).toBe(node);
  });

  it("stringifies display values", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(stringifyValue(undefined)).toBe("");
    expect(stringifyValue("ready")).toBe("ready");
    expect(stringifyValue({ count: 1 })).toBe('{\n  "count": 1\n}');
    expect(stringifyValue(circular)).toBe("[object Object]");
  });

  it("throws clear errors for primitives outside their local providers", () => {
    expect(() =>
      render(
        <ChatProvider controller={createChatController()}>
          <Thread.ScrollToBottom />
        </ChatProvider>,
      ),
    ).toThrow("Thread primitives must be used inside Thread.Root.");

    expect(() =>
      render(
        <ChatProvider controller={createChatController()}>
          <Composer.Input />
        </ChatProvider>,
      ),
    ).toThrow("Composer primitives must be used inside Composer.Root.");

    expect(() =>
      render(
        <CompletionProvider controller={createCompletionController()}>
          <Completion.Input />
        </CompletionProvider>,
      ),
    ).toThrow("Completion input primitives must be used inside Completion.Form.");

    expect(() => render(<Completion.Root />)).toThrow(
      "Anvia completion primitives must be used inside CompletionProvider.",
    );

    expect(() => render(<Message.Text />)).toThrow(
      "Message part primitives must be used inside Message.Parts or Message.Part.",
    );

    expect(() =>
      render(
        <ChatProvider controller={createChatController()}>
          <HumanInput.Approve />
        </ChatProvider>,
      ),
    ).toThrow("Approval primitives must be used inside HumanInput.Approval.");

    expect(() =>
      render(
        <ChatProvider controller={createChatController()}>
          <HumanInput.Question />
        </ChatProvider>,
      ),
    ).toThrow("Question primitives must be used inside HumanInput.Question.");

    expect(() =>
      render(
        <ChatProvider controller={createChatController()}>
          <HumanInput.QuestionChoice />
        </ChatProvider>,
      ),
    ).toThrow("Question choice primitives must be used inside HumanInput.QuestionPrompt.");

    expect(() => render(<Attachment.Name />)).toThrow(
      "Attachment primitives must be used inside Attachment.Root.",
    );
  });
});
