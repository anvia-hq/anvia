import type {
  ChatResumeOptions,
  ChatResumeState,
  ResumableStreamEnvelope,
  UIMessage,
} from "./types";

const storageKeyPrefix = "anvia:chat-resume:";

export function loadChatResumeState(
  options: ChatResumeOptions | undefined,
): ChatResumeState | undefined {
  const storage = resolveResumeStorage(options);
  const key = resumeStorageKey(options);
  if (storage === undefined || key === undefined) {
    return undefined;
  }

  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return undefined;
  }

  if (raw === null) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
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
  if (storage === undefined || key === undefined) {
    return;
  }

  try {
    storage.setItem(key, JSON.stringify(state));
  } catch {
    // Resume state is an optimization; storage failures should not break streaming.
  }
}

export function clearChatResumeState(options: ChatResumeOptions | undefined): void {
  const storage = resolveResumeStorage(options);
  const key = resumeStorageKey(options);
  if (storage === undefined || key === undefined) {
    return;
  }

  try {
    storage.removeItem(key);
  } catch {
    // Resume state is an optimization; storage failures should not break streaming.
  }
}

export function isResumableStreamEnvelope<TEvent>(
  value: unknown,
): value is ResumableStreamEnvelope<TEvent> {
  if (!isRecord(value)) {
    return false;
  }

  if (value.type === "stream_start" && typeof value.streamId === "string" && value.eventId === 0) {
    return true;
  }

  if (
    value.type === "stream_event" &&
    typeof value.streamId === "string" &&
    typeof value.eventId === "number" &&
    "event" in value
  ) {
    return true;
  }

  return (
    value.type === "stream_end" &&
    typeof value.streamId === "string" &&
    typeof value.eventId === "number" &&
    typeof value.status === "string"
  );
}

function resumeStorageKey(options: ChatResumeOptions | undefined): string | undefined {
  if (options === undefined) {
    return undefined;
  }

  return `${storageKeyPrefix}${options.key}`;
}

function resolveResumeStorage(options: ChatResumeOptions | undefined): Storage | undefined {
  if (options === undefined) {
    return undefined;
  }

  if (typeof options.storage === "object") {
    return options.storage;
  }

  const storageName = options.storage ?? "sessionStorage";
  if (typeof globalThis.window === "undefined") {
    return undefined;
  }

  try {
    return storageName === "localStorage" ? window.localStorage : window.sessionStorage;
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
    Number.isFinite(value.lastEventId) &&
    value.lastEventId >= 0 &&
    Array.isArray(value.messages) &&
    value.messages.every(isUIMessage)
  );
}

function isUIMessage(value: unknown): value is UIMessage {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.role === "string" &&
    Array.isArray(value.parts)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
