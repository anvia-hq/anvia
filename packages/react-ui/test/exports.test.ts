import { describe, expect, expectTypeOf, it } from "vitest";
import type {
  ComposerAttachmentInput,
  ComposerAttachmentsUpdate,
  ComposerEntity,
  ComposerMessageMetadata,
  ComposerQuote,
  ComposerSubmitMessage,
  ComposerSubmitMessageArgs,
  ImageContextValue,
  MessageAttachmentPart,
  MessageEntityProps,
  MessageToolPart,
  SelectionToolbarSelection,
  ThreadListController,
  ThreadListRecord,
} from "../src";
import {
  GraphExplorerNodePrimitive,
  GraphExplorerPrimitive,
  type GraphExplorerController,
  GraphExplorerProvider,
  useGraphExplorerContext,
} from "../src/graph-explorer";
import { AttachmentPrimitive } from "../src/attachment";
import type { ComposerSubmitMessage as ChatComposerSubmitMessage } from "../src/chat";
import { ChatProvider, ComposerPrimitive, ThreadPrimitive } from "../src/chat";
import { CompletionPrimitive, CompletionProvider } from "../src/completion";
import { HumanInputPrimitive } from "../src/human-input";
import { ImagePrimitive } from "../src/image";
import { MessagePrimitive } from "../src/message";
import { SelectionToolbarPrimitive } from "../src/selection-toolbar";
import {
  ChatProvider as SharedChatProvider,
  CompletionProvider as SharedCompletionProvider,
  ThreadListProvider as SharedThreadListProvider,
} from "../src/shared";
import {
  ThreadListItemPrimitive,
  ThreadListPrimitive,
  ThreadListProvider,
} from "../src/thread-list";

describe("public entrypoints", () => {
  it("exports namespace barrels from subpaths", () => {
    expect(AttachmentPrimitive.Root).toBeTypeOf("object");
    expect(ThreadPrimitive.Root).toBeTypeOf("object");
    expect(ComposerPrimitive.Root).toBeTypeOf("object");
    expect(ComposerPrimitive.AttachmentInput).toBeTypeOf("object");
    expect(MessagePrimitive.Root).toBeTypeOf("object");
    expect(MessagePrimitive.Entity).toBeTypeOf("object");
    expect(HumanInputPrimitive.Approvals).toBeTypeOf("object");
    expect(CompletionPrimitive.Root).toBeTypeOf("object");
    expect(GraphExplorerPrimitive.Root).toBeTypeOf("object");
    expect(GraphExplorerPrimitive.Viewport).toBeTypeOf("object");
    expect(GraphExplorerNodePrimitive.Root).toBeTypeOf("object");
    expect(GraphExplorerProvider).toBeTypeOf("function");
    expect(useGraphExplorerContext).toBeTypeOf("function");
    expect(ImagePrimitive.Root).toBeTypeOf("object");
    expect(SelectionToolbarPrimitive.Root).toBeTypeOf("object");
    expect(ThreadListPrimitive.Root).toBeTypeOf("object");
    expect(ThreadListItemPrimitive.Root).toBeTypeOf("object");
  });

  it("keeps shared provider exports aligned with domain barrels", () => {
    expect(SharedChatProvider).toBe(ChatProvider);
    expect(SharedCompletionProvider).toBe(CompletionProvider);
    expect(SharedThreadListProvider).toBe(ThreadListProvider);
  });

  it("exports public helper types from domain barrels", () => {
    expectTypeOf<MessageToolPart>().toMatchTypeOf<{ type: "tool" }>();
    expectTypeOf<MessageAttachmentPart>().toMatchTypeOf<{ type: "attachment" }>();
    expectTypeOf<MessageEntityProps>().toMatchTypeOf<{ entity: ComposerEntity }>();
    expectTypeOf<ComposerMessageMetadata["composer"]["entities"]>().toMatchTypeOf<
      readonly object[]
    >();
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
    expectTypeOf<ComposerQuote>().toMatchTypeOf<{ text: string; messageId: string }>();
    expectTypeOf<ImageContextValue>().toMatchTypeOf<{
      isImage: boolean;
      zoomOpen: boolean;
    }>();
    expectTypeOf<SelectionToolbarSelection>().toMatchTypeOf<{
      text: string;
      messageId: string;
      rect: DOMRect;
    }>();
    expectTypeOf<ThreadListRecord>().toMatchTypeOf<{ id: string; title?: string }>();
    expectTypeOf<GraphExplorerController>().toMatchTypeOf<{
      nodes: readonly { id: string }[];
      query: string;
      selectNode(nodeId: string | undefined): void;
    }>();
    expectTypeOf<ThreadListController>().toMatchTypeOf<{
      threads: ThreadListRecord[];
      createThread(): Promise<void> | void;
      switchThread(threadId: string): Promise<void> | void;
    }>();
  });
});
