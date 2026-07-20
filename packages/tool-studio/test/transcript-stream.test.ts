import { describe, expect, it } from "vitest";
import {
  currentTurnAssistantEntryId,
  hasTerminalTranscriptError,
  transcriptStreamAdapter,
} from "../src/ui/app/modules/playground/transcript-stream";
import type { TranscriptEntry } from "../src/ui/app/modules/shared/types";

describe("Studio transcript stream smoothing", () => {
  it("smooths assistant and reasoning text while keeping other entries opaque", () => {
    const assistant: TranscriptEntry = {
      entryId: 1,
      kind: "message",
      role: "assistant",
      text: "Complete response",
    };
    const reasoning: TranscriptEntry = { entryId: 2, kind: "reasoning", text: "Thinking" };
    const tool: TranscriptEntry = { entryId: 3, kind: "tool", toolName: "search" };
    const user: TranscriptEntry = {
      entryId: 4,
      kind: "message",
      role: "user",
      text: "Question",
    };

    expect(transcriptStreamAdapter.getText(assistant)).toBe("Complete response");
    expect(transcriptStreamAdapter.getText(reasoning)).toBe("Thinking");
    expect(transcriptStreamAdapter.getText(tool)).toBeUndefined();
    expect(transcriptStreamAdapter.getText(user)).toBeUndefined();
    expect(transcriptStreamAdapter.withText(assistant, "Partial")).toMatchObject({
      role: "assistant",
      text: "Partial",
    });
    expect(transcriptStreamAdapter.withText(reasoning, "Think")).toMatchObject({
      kind: "reasoning",
      text: "Think",
    });
    expect(transcriptStreamAdapter.withText(tool, "ignored")).toBe(tool);
  });

  it("does not turn a pending assistant placeholder into an invalid transcript entry", () => {
    const pending: TranscriptEntry = {
      entryId: 1,
      kind: "message",
      role: "assistant",
      text: "",
      tone: "pending",
    };

    expect(transcriptStreamAdapter.withText(pending, "")).toBe(pending);
  });

  it("finds the current turn assistant without crossing the preceding user entry", () => {
    expect(
      currentTurnAssistantEntryId([
        { entryId: 1, kind: "message", role: "assistant", text: "Old" },
        { entryId: 2, kind: "message", role: "user", text: "New question" },
        { entryId: 3, kind: "reasoning", text: "Thinking" },
      ]),
    ).toBeUndefined();
    expect(
      currentTurnAssistantEntryId([
        { entryId: 1, kind: "message", role: "user", text: "Question" },
        { entryId: 2, kind: "message", role: "assistant", text: "Answer" },
        { entryId: 3, kind: "tool", toolName: "search" },
      ]),
    ).toBe(2);
  });

  it("requests an immediate flush only for a terminal assistant error", () => {
    expect(
      hasTerminalTranscriptError([
        { entryId: 1, kind: "message", role: "assistant", text: "Partial" },
      ]),
    ).toBe(false);
    expect(
      hasTerminalTranscriptError([
        {
          entryId: 1,
          kind: "message",
          role: "assistant",
          text: "Request failed",
          tone: "error",
        },
      ]),
    ).toBe(true);
  });
});
