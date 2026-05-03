import type { Message } from "@anvia/core";
import type { ChangeEvent } from "react";
import { formatToolValue } from "./format";
import { isRecord } from "./object";
import type { ChatMessage, TranscriptEntry } from "./types";

let transcriptSequence = 0;

export function setTranscriptSequence(value: number): void {
  transcriptSequence = value;
}

export function resetTranscriptSequence(): void {
  transcriptSequence = 0;
}

export function toHistory(messages: TranscriptEntry[]): Message[] {
  return messages
    .filter(
      (message): message is ChatMessage =>
        message.kind === "message" && message.text.trim().length > 0,
    )
    .map((message) => ({
      role: message.role,
      content: [{ type: "text", text: message.text }],
    }));
}

export function formValue(event: ChangeEvent<HTMLTextAreaElement>): string {
  return event.currentTarget.value;
}

export function resizeTextarea(textarea: HTMLTextAreaElement | null) {
  if (textarea === null) {
    return;
  }
  textarea.style.height = "auto";
  textarea.style.height = `${textarea.scrollHeight}px`;
}

export function nextTranscriptId(): number {
  const id = transcriptSequence;
  transcriptSequence += 1;
  return id;
}

export function nextSequence(transcript: TranscriptEntry[]): number {
  return transcript.reduce((max, entry) => Math.max(max, entry.entryId + 1), 0);
}

export function findMatchingToolIndex(
  messages: TranscriptEntry[],
  toolName: string,
  callId: string | undefined,
): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message === undefined) {
      continue;
    }
    if (message.kind !== "tool" || message.toolName !== toolName || message.result !== undefined) {
      continue;
    }
    if (callId === undefined || message.callId === callId) {
      return index;
    }
  }
  return -1;
}

export function findMatchingToolIndexByCall(
  messages: TranscriptEntry[],
  toolName: string,
  callId: string | undefined,
): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message === undefined) {
      continue;
    }
    if (message.kind !== "tool" || message.toolName !== toolName) {
      continue;
    }
    if (callId === undefined || message.callId === callId) {
      return index;
    }
  }
  return -1;
}

export function messageText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (!isRecord(value)) {
    return "";
  }
  if (typeof value.text === "string") {
    return value.text;
  }
  if (typeof value.content === "string") {
    return value.content;
  }
  if (Array.isArray(value.content)) {
    return value.content.map(contentText).filter(Boolean).join("\n");
  }
  return "";
}

function contentText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (!isRecord(value)) {
    return "";
  }
  if (typeof value.text === "string") {
    return value.text;
  }
  if (value.type === "tool_call" && isRecord(value.function)) {
    return `${String(value.function.name ?? "tool")}(${formatToolValue(value.function.arguments)})`;
  }
  if (value.type === "tool_result" && Array.isArray(value.content)) {
    return value.content.map(contentText).filter(Boolean).join("\n");
  }
  return typeof value.type === "string" ? value.type : "";
}

export async function readJsonl(
  stream: ReadableStream<Uint8Array>,
  onEvent: (event: unknown) => void | Promise<void>,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const next = await reader.read();
    if (next.done) {
      break;
    }
    buffer += decoder.decode(next.value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim().length > 0) {
        await onEvent(JSON.parse(line));
      }
    }
  }

  buffer += decoder.decode();
  if (buffer.trim().length > 0) {
    await onEvent(JSON.parse(buffer));
  }
}

export function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}
