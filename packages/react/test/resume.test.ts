import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearChatResumeState,
  isResumableStreamEnvelope,
  loadChatResumeState,
  saveChatResumeState,
} from "../src/resume";
import type { ChatResumeOptions, ChatResumeState } from "../src/types";

const state: ChatResumeState = {
  version: 1,
  streamId: "stream_1",
  lastEventId: 3,
  messages: [
    {
      id: "user_1",
      role: "user",
      parts: [{ id: "part_1", type: "text", text: "hello" }],
    },
  ],
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe("chat resume state", () => {
  it("round-trips session, local, and custom storage state", () => {
    const customStorage = createStorage();
    const options: ChatResumeOptions[] = [
      { key: "session" },
      { key: "local", storage: "localStorage" },
      { key: "custom", storage: customStorage },
    ];

    for (const option of options) {
      saveChatResumeState(option, state);
      expect(loadChatResumeState(option)).toEqual(state);
      clearChatResumeState(option);
      expect(loadChatResumeState(option)).toBeUndefined();
    }
  });

  it.each([
    ["invalid JSON", "{"],
    ["unsupported version", JSON.stringify({ ...state, version: 2 })],
    ["negative cursor", JSON.stringify({ ...state, lastEventId: -1 })],
    ["non-numeric cursor", JSON.stringify({ ...state, lastEventId: "3" })],
    ["missing stream id", JSON.stringify({ ...state, streamId: undefined })],
    ["malformed messages", JSON.stringify({ ...state, messages: [{ role: "user" }] })],
  ])("ignores %s", (_label, raw) => {
    const storage = createStorage({ "anvia:chat-resume:thread": raw });

    expect(loadChatResumeState({ key: "thread", storage })).toBeUndefined();
  });

  it("treats storage as optional when the browser or storage access is unavailable", () => {
    const throwingStorage = createStorage();
    vi.spyOn(throwingStorage, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(throwingStorage, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(throwingStorage, "removeItem").mockImplementation(() => {
      throw new Error("blocked");
    });

    expect(loadChatResumeState({ key: "thread", storage: throwingStorage })).toBeUndefined();
    expect(() =>
      saveChatResumeState({ key: "thread", storage: throwingStorage }, state),
    ).not.toThrow();
    expect(() => clearChatResumeState({ key: "thread", storage: throwingStorage })).not.toThrow();
    expect(loadChatResumeState(undefined)).toBeUndefined();

    vi.stubGlobal("window", undefined);
    expect(loadChatResumeState({ key: "thread" })).toBeUndefined();
  });

  it.each([
    [{ type: "stream_start", streamId: "stream_1", eventId: 0 }, true],
    [{ type: "stream_event", streamId: "stream_1", eventId: 1, event: { type: "delta" } }, true],
    [{ type: "stream_end", streamId: "stream_1", eventId: 1, status: "completed" }, true],
    [{ type: "stream_start", streamId: "stream_1", eventId: 1 }, false],
    [{ type: "stream_event", streamId: "stream_1", eventId: "1", event: {} }, false],
    [{ type: "stream_end", streamId: "stream_1", eventId: 1 }, false],
    [null, false],
  ])("recognizes resumable envelope shape %#", (value, expected) => {
    expect(isResumableStreamEnvelope(value)).toBe(expected);
  });
});

function createStorage(initial: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(initial));
  return {
    get length() {
      return values.size;
    },
    clear: vi.fn(() => values.clear()),
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    key: vi.fn((index: number) => [...values.keys()][index] ?? null),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
  };
}
