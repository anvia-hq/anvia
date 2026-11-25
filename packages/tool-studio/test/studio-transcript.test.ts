import { describe, expect, it } from "vitest";
import { Message, UserContent } from "../../core/test/helpers/imports";
import { transcriptFromMessages } from "../src/runtime/transcript";
import {
  cancelPendingTranscriptRun,
  completeTranscriptRun,
} from "../src/ui/app/modules/playground/use-playground-transcript";
import {
  findMatchingToolIndex,
  findMatchingToolIndexByCall,
  messageText,
  resetTranscriptSequence,
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

  it("keeps partial output and cancels only current-run human input", () => {
    const transcript: TranscriptEntry[] = [
      { entryId: 1, kind: "message", role: "user", text: "Earlier" },
      {
        entryId: 2,
        kind: "tool",
        toolName: "old_tool",
        approval: {
          id: "approval_old",
          status: "pending",
          requestedAt: "2026-07-17T00:00:00.000Z",
        },
      },
      { entryId: 3, kind: "message", role: "user", text: "Current" },
      { entryId: 4, kind: "message", role: "assistant", text: "Partial answer" },
      {
        entryId: 5,
        kind: "tool",
        toolName: "protected_tool",
        approval: {
          id: "approval_current",
          status: "pending",
          requestedAt: "2026-07-17T00:01:00.000Z",
        },
      },
      {
        entryId: 6,
        kind: "tool",
        toolName: "ask_question",
        question: {
          id: "question_current",
          status: "pending",
          requestedAt: "2026-07-17T00:01:01.000Z",
          questions: [
            {
              id: "choice",
              question: "Continue?",
              choices: [{ label: "Yes", value: "yes" }],
              allowCustom: false,
            },
          ],
        },
      },
      { entryId: 7, kind: "message", role: "assistant", text: "", tone: "pending" },
    ];

    const cancelled = cancelPendingTranscriptRun(transcript, "2026-07-17T00:02:00.000Z", 65_000);

    expect(cancelled).toContainEqual({
      entryId: 4,
      kind: "message",
      role: "assistant",
      text: "Partial answer",
      durationMs: 65_000,
    });
    expect(cancelled).not.toContainEqual(expect.objectContaining({ entryId: 7 }));
    expect((cancelled[1] as Extract<TranscriptEntry, { kind: "tool" }>).approval?.status).toBe(
      "pending",
    );
    expect((cancelled[4] as Extract<TranscriptEntry, { kind: "tool" }>).approval).toMatchObject({
      status: "cancelled",
      resolvedAt: "2026-07-17T00:02:00.000Z",
      reason: "Run cancelled in Anvia Studio.",
    });
    expect((cancelled[5] as Extract<TranscriptEntry, { kind: "tool" }>).question).toMatchObject({
      status: "cancelled",
      cancelledAt: "2026-07-17T00:02:00.000Z",
    });
  });

  it("completes pending and empty assistant responses with a duration", () => {
    resetTranscriptSequence();
    const completedPending = completeTranscriptRun(
      [
        { entryId: 0, kind: "message", role: "user", text: "Hello" },
        { entryId: 1, kind: "message", role: "assistant", text: "", tone: "pending" },
      ],
      1_200,
    );
    expect(completedPending[1]).toEqual({
      entryId: 1,
      kind: "message",
      role: "assistant",
      text: "",
      durationMs: 1_200,
    });

    setTranscriptSequence(2);
    const completedWithoutText = completeTranscriptRun(
      [
        { entryId: 0, kind: "message", role: "user", text: "Use a tool" },
        { entryId: 1, kind: "tool", toolName: "lookup", result: "done" },
      ],
      2_500,
    );
    expect(completedWithoutText.at(-1)).toEqual({
      entryId: 2,
      kind: "message",
      role: "assistant",
      text: "",
      durationMs: 2_500,
    });
    expect(toHistory(completedWithoutText)).toEqual([
      { role: "user", content: [{ type: "text", text: "Use a tool" }] },
    ]);
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
});
