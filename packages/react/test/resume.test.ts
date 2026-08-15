// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { clearChatResumeState, loadChatResumeState, saveChatResumeState } from "../src/resume";

describe("chat resume storage", () => {
  it("persists and clears a validated framed-stream cursor", () => {
    const options = { key: "test", storage: window.sessionStorage } as const;
    const state = {
      version: 1 as const,
      streamId: "stream_1",
      lastEventId: 4,
      messages: [],
    };
    saveChatResumeState(options, state);
    expect(loadChatResumeState(options)).toEqual(state);
    clearChatResumeState(options);
    expect(loadChatResumeState(options)).toBeUndefined();
  });
});
