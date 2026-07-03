import { describe, expect, expectTypeOf, it } from "vitest";
import type {
  ComposerAttachmentInput,
  ComposerAttachmentsUpdate,
  ComposerSubmitMessage,
  ComposerSubmitMessageArgs,
  MessageAttachmentPart,
  MessageToolPart,
} from "../src";
import { Attachment } from "../src/attachment";
import type { ComposerSubmitMessage as ChatComposerSubmitMessage } from "../src/chat";
import { ChatProvider, Composer, Thread } from "../src/chat";
import { Completion, CompletionProvider } from "../src/completion";
import { HumanInput } from "../src/human-input";
import { Message } from "../src/message";
import {
  ChatProvider as SharedChatProvider,
  CompletionProvider as SharedCompletionProvider,
} from "../src/shared";

describe("public entrypoints", () => {
  it("exports namespace barrels from subpaths", () => {
    expect(Attachment.Root).toBeTypeOf("object");
    expect(Thread.Root).toBeTypeOf("object");
    expect(Composer.Root).toBeTypeOf("object");
    expect(Composer.AttachmentInput).toBeTypeOf("object");
    expect(Message.Root).toBeTypeOf("object");
    expect(HumanInput.Approvals).toBeTypeOf("object");
    expect(Completion.Root).toBeTypeOf("object");
  });

  it("keeps shared provider exports aligned with domain barrels", () => {
    expect(SharedChatProvider).toBe(ChatProvider);
    expect(SharedCompletionProvider).toBe(CompletionProvider);
  });

  it("exports public helper types from domain barrels", () => {
    expectTypeOf<MessageToolPart>().toMatchTypeOf<{ type: "tool" }>();
    expectTypeOf<MessageAttachmentPart>().toMatchTypeOf<{ type: "attachment" }>();
    expectTypeOf<File>().toMatchTypeOf<ComposerAttachmentInput>();
    expectTypeOf<
      Array<{ id: string; type: "image" | "document" | "file" }>
    >().toMatchTypeOf<ComposerAttachmentsUpdate>();
    expectTypeOf<
      (
        attachments: Array<{ id: string; type: "image" | "document" | "file" }>,
      ) => Array<{ id: string; type: "image" | "document" | "file" }>
    >().toMatchTypeOf<ComposerAttachmentsUpdate>();
    expectTypeOf<ComposerSubmitMessageArgs>().toMatchTypeOf<{
      input: string;
      attachments: Array<{ id: string; type: "image" | "document" | "file" }>;
      clear(): void;
    }>();
    expectTypeOf<ComposerSubmitMessage>().parameters.toMatchTypeOf<[ComposerSubmitMessageArgs]>();
    expectTypeOf<ChatComposerSubmitMessage>().toEqualTypeOf<ComposerSubmitMessage>();
  });
});
