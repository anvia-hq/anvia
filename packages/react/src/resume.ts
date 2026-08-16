import { type ClientDataMap, type ClientMetadata, parseUIMessages } from "@anvia/client";
import type { ChatResumeOptions, ChatResumeState } from "./types";

const storageKeyPrefix = "anvia:chat-resume:";

export function loadChatResumeState<
  Metadata extends ClientMetadata = ClientMetadata,
  Data extends ClientDataMap = ClientDataMap,
>(options: ChatResumeOptions | undefined): ChatResumeState<Metadata, Data> | undefined {
  const storage = resolveResumeStorage(options);
  const key = resumeStorageKey(options);
  if (storage === undefined || key === undefined) return undefined;
  try {
    const raw = storage.getItem(key);
    if (raw === null) return undefined;
    const parsed: unknown = JSON.parse(raw);
    return parseChatResumeState<Metadata, Data>(parsed);
  } catch {
    return undefined;
  }
}

export function saveChatResumeState<Metadata extends ClientMetadata, Data extends ClientDataMap>(
  options: ChatResumeOptions | undefined,
  state: ChatResumeState<Metadata, Data>,
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

function parseChatResumeState<Metadata extends ClientMetadata, Data extends ClientDataMap>(
  value: unknown,
): ChatResumeState<Metadata, Data> | undefined {
  if (
    !isRecord(value) ||
    value.version !== 2 ||
    typeof value.streamId !== "string" ||
    typeof value.lastEventId !== "number" ||
    !Number.isSafeInteger(value.lastEventId) ||
    value.lastEventId < 0
  ) {
    return undefined;
  }
  try {
    return {
      version: 2,
      streamId: value.streamId,
      lastEventId: value.lastEventId,
      messages: parseUIMessages<Metadata, Data>(value.messages),
    };
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
