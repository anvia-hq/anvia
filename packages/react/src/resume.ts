import type { UIMessage } from "@anvia/client";
import type { ChatResumeOptions, ChatResumeState } from "./types";

const storageKeyPrefix = "anvia:chat-resume:";

export function loadChatResumeState(
  options: ChatResumeOptions | undefined,
): ChatResumeState | undefined {
  const storage = resolveResumeStorage(options);
  const key = resumeStorageKey(options);
  if (storage === undefined || key === undefined) return undefined;
  try {
    const raw = storage.getItem(key);
    if (raw === null) return undefined;
    const parsed: unknown = JSON.parse(raw);
    return isChatResumeState(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function saveChatResumeState(
  options: ChatResumeOptions | undefined,
  state: ChatResumeState,
): void {
  const storage = resolveResumeStorage(options);
  const key = resumeStorageKey(options);
  if (storage === undefined || key === undefined) return;
  try {
    storage.setItem(key, JSON.stringify(state));
  } catch {
    // Resume persistence is optional and must not interrupt a live stream.
  }
}

export function clearChatResumeState(options: ChatResumeOptions | undefined): void {
  const storage = resolveResumeStorage(options);
  const key = resumeStorageKey(options);
  if (storage === undefined || key === undefined) return;
  try {
    storage.removeItem(key);
  } catch {
    // Resume persistence is optional.
  }
}

function resumeStorageKey(options: ChatResumeOptions | undefined): string | undefined {
  return options === undefined ? undefined : `${storageKeyPrefix}${options.key}`;
}

function resolveResumeStorage(options: ChatResumeOptions | undefined): Storage | undefined {
  if (options === undefined) return undefined;
  if (typeof options.storage === "object") return options.storage;
  if (typeof globalThis.window === "undefined") return undefined;
  try {
    return options.storage === "localStorage" ? window.localStorage : window.sessionStorage;
  } catch {
    return undefined;
  }
}

function isChatResumeState(value: unknown): value is ChatResumeState {
  return (
    isRecord(value) &&
    value.version === 1 &&
    typeof value.streamId === "string" &&
    typeof value.lastEventId === "number" &&
    Number.isSafeInteger(value.lastEventId) &&
    value.lastEventId >= 0 &&
    Array.isArray(value.messages) &&
    value.messages.every(isUIMessage)
  );
}

function isUIMessage(value: unknown): value is UIMessage {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    ["system", "user", "assistant", "tool"].includes(value.role as string) &&
    Array.isArray(value.parts)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
