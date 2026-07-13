import { Message, UserContent } from "@anvia/core/completion";
import { describe, expect, it, vi } from "vitest";
import { transcriptFromMessages } from "../src/runtime/transcript";
import {
  findMatchingToolIndex,
  findMatchingToolIndexByCall,
  formValue,
  messageText,
  nextPaint,
  nextSequence,
  nextTranscriptId,
  readJsonl,
  resetTranscriptSequence,
  resizeTextarea,
  setTranscriptSequence,
  toHistory,
} from "../src/ui/app/modules/shared/transcript";
import type { TranscriptEntry } from "../src/ui/app/modules/shared/types";

describe("Studio transcript helpers", () => {
  it("attaches message-scoped files only to the first user text entry", () => {
    const attachment = { kind: "image", url: "https://example.com/image.png" };

    expect(
      transcriptFromMessages([
        Message.user([
          UserContent.text("first"),
          UserContent.imageUrl(attachment.url),
          UserContent.text("second"),
        ]),
      ]),
    ).toEqual([
      {
        entryId: 0,
        kind: "message",
        role: "user",
        text: "first",
        attachments: [attachment],
      },
      { entryId: 1, kind: "message", role: "user", text: "second" },
    ]);

    expect(transcriptFromMessages([Message.user([UserContent.imageUrl(attachment.url)])])).toEqual([
      {
        entryId: 0,
        kind: "message",
        role: "user",
        text: "",
        attachments: [attachment],
      },
    ]);
  });

  it("maintains deterministic transcript ids and sequence lookups", () => {
    resetTranscriptSequence();
    expect(nextTranscriptId()).toBe(0);
    expect(nextTranscriptId()).toBe(1);
    setTranscriptSequence(42);
    expect(nextTranscriptId()).toBe(42);
    expect(nextSequence([{ entryId: 4 }, { entryId: 9 }] as TranscriptEntry[])).toBe(10);
  });

  it("extracts user history from non-empty chat messages", () => {
    expect(
      toHistory([
        { entryId: 1, kind: "message", role: "user", text: "Hello" },
        { entryId: 2, kind: "message", role: "assistant", text: "  " },
        { entryId: 3, kind: "tool", toolName: "lookup" },
      ]),
    ).toEqual([{ role: "user", content: [{ type: "text", text: "Hello" }] }]);
  });

  it("finds pending tool calls by name and call id", () => {
    const transcript = [
      { entryId: 1, kind: "tool", toolName: "lookup", callId: "done", result: "ok" },
      { entryId: 2, kind: "tool", toolName: "search", callId: "call_1" },
      { entryId: 3, kind: "tool", toolName: "search", callId: "call_2" },
    ] as TranscriptEntry[];

    expect(findMatchingToolIndex(transcript, "search", "call_1")).toBe(1);
    expect(findMatchingToolIndex(transcript, "search", undefined)).toBe(2);
    expect(findMatchingToolIndex(transcript, "lookup", "done")).toBe(-1);
    expect(findMatchingToolIndexByCall(transcript, "lookup", "done")).toBe(0);
    expect(findMatchingToolIndexByCall(transcript, "missing", undefined)).toBe(-1);
  });

  it("extracts display text from common message content shapes", () => {
    expect(messageText("hello")).toBe("hello");
    expect(messageText(null)).toBe("");
    expect(messageText({ text: "from text" })).toBe("from text");
    expect(messageText({ content: "from content" })).toBe("from content");
    expect(
      messageText({
        content: [
          "plain",
          { text: "nested" },
          { type: "tool_call", function: { name: "lookup", arguments: { id: 1 } } },
          { type: "tool_result", content: [{ text: "result" }] },
          { type: "image" },
        ],
      }),
    ).toBe('plain\nnested\nlookup({\n  "id": 1\n})\nresult\nimage');
  });

  it("reads jsonl streams and awaits async event handlers", async () => {
    const events: unknown[] = [];
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode('{"type":"first"}\n{"type":"second"}\n'));
        controller.close();
      },
    });

    await readJsonl(stream, async (event) => {
      await Promise.resolve();
      events.push(event);
    });

    expect(events).toEqual([{ type: "first" }, { type: "second" }]);
  });

  it("handles textarea values, resizing, and next paint", async () => {
    expect(formValue({ currentTarget: { value: "typed" } } as never)).toBe("typed");
    expect(resizeTextarea(null)).toBeUndefined();

    const textarea = { style: { height: "40px" }, scrollHeight: 88 } as HTMLTextAreaElement;
    resizeTextarea(textarea);
    expect(textarea.style.height).toBe("88px");

    const callbacks: FrameRequestCallback[] = [];
    const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return callbacks.length;
    });

    const painted = nextPaint();
    callbacks.shift()?.(1);
    callbacks.shift()?.(2);
    await expect(painted).resolves.toBeUndefined();

    if (originalRequestAnimationFrame === undefined) {
      Reflect.deleteProperty(globalThis, "requestAnimationFrame");
    } else {
      globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    }
  });
});
