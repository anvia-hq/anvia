import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  AttachmentPrimitive as Attachment,
  ChatProvider,
  CompletionPrimitive as Completion,
  CompletionProvider,
  ComposerPrimitive as Composer,
  HumanInputPrimitive as HumanInput,
  MessagePrimitive as Message,
  ThreadPrimitive as Thread,
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
    ).toThrow();

    expect(() =>
      render(
        <ChatProvider controller={createChatController()}>
          <Composer.Input />
        </ChatProvider>,
      ),
    ).toThrow();

    expect(() =>
      render(
        <CompletionProvider controller={createCompletionController()}>
          <Completion.Input />
        </CompletionProvider>,
      ),
    ).toThrow();

    expect(() => render(<Completion.Root />)).toThrow();

    expect(() => render(<Message.Text />)).toThrow();

    expect(() =>
      render(
        <ChatProvider controller={createChatController()}>
          <HumanInput.Approve />
        </ChatProvider>,
      ),
    ).toThrow();

    expect(() =>
      render(
        <ChatProvider controller={createChatController()}>
          <HumanInput.Question />
        </ChatProvider>,
      ),
    ).toThrow();

    expect(() =>
      render(
        <ChatProvider controller={createChatController()}>
          <HumanInput.QuestionChoice />
        </ChatProvider>,
      ),
    ).toThrow();

    expect(() => render(<Attachment.Name />)).toThrow();
  });
});
