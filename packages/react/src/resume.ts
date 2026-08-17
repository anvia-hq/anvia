import {
  type ClientDataMap,
  type ClientInteraction,
  type ClientMetadata,
  type ClientStreamRequest,
  parseClientStreamRequest,
  parseUIMessages,
} from "@anvia/client";
import { parseAgentInteractionRequest } from "@anvia/core/agent";
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
    value.version !== 3 ||
    typeof value.streamId !== "string" ||
    typeof value.lastEventId !== "number" ||
    !Number.isSafeInteger(value.lastEventId) ||
    value.lastEventId < 0
  ) {
    return undefined;
  }
  try {
    return {
      version: 3,
      streamId: value.streamId,
      lastEventId: value.lastEventId,
      messages: parseUIMessages<Metadata, Data>(value.messages),
      interactions: parseInteractions(value.interactions),
      request: parseClientStreamRequest(value.request) as ClientStreamRequest<Metadata>,
    };
  } catch {
    return undefined;
  }
}

function parseInteractions(value: unknown): readonly ClientInteraction[] {
  if (!Array.isArray(value)) throw new TypeError("interactions must be an array");
  return value.map((item) => {
    if (
      !isRecord(item) ||
      typeof item.runId !== "string" ||
      (item.status !== "pending" && item.status !== "responded" && item.status !== "cancelled")
    ) {
      throw new TypeError("interaction state is invalid");
    }
    return {
      request: parseAgentInteractionRequest(item.request),
      runId: item.runId,
      status: item.status,
    };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
