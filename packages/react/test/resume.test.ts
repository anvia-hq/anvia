// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { clearChatResumeState, loadChatResumeState, saveChatResumeState } from "../src/resume";

describe("chat resume storage", () => {
  it("persists and clears a validated framed-stream cursor", () => {
    const options = { key: "test", storage: window.sessionStorage } as const;
    const state = {
      version: 3 as const,
      streamId: "stream_1",
      lastEventId: 4,
      messages: [],
      interactions: [
        {
          request: {
            type: "tool-approval" as const,
            id: "interaction_1",
            toolName: "delete_account",
            toolCallId: "call_1",
            internalCallId: "internal_1",
            input: {},
          },
          runId: "run_1",
          status: "pending" as const,
        },
      ],
      request: { type: "messages" as const, messages: [] },
    };
    saveChatResumeState(options, state);
    expect(loadChatResumeState(options)).toEqual(state);
    clearChatResumeState(options);
    expect(loadChatResumeState(options)).toBeUndefined();
  });

  it("rejects legacy v2 resume state", () => {
    const options = { key: "legacy", storage: window.sessionStorage } as const;
    window.sessionStorage.setItem(
      "anvia:chat-resume:legacy",
      JSON.stringify({ version: 2, streamId: "stream_1", lastEventId: 4, messages: [] }),
    );
    expect(loadChatResumeState(options)).toBeUndefined();
  });
});
