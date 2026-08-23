import type { Message, ToolResultOutput } from "@anvia/core/completion";
import type { StudioTranscriptAttachment, StudioTranscriptEntry } from "../types";
import { formatJson } from "./json";

export function renumberTranscript(entries: StudioTranscriptEntry[]): StudioTranscriptEntry[] {
  return entries.map((entry, entryId) => ({ ...entry, entryId }));
}

export function transcriptFromMessages(messages: readonly Message[]): StudioTranscriptEntry[] {
  const transcript: StudioTranscriptEntry[] = [];
  for (const message of messages) {
    if (message.role === "system") {
      continue;
    }
    if (message.role === "user") {
      const attachments = attachmentsFromMessage(message);
      let textEntryAdded = false;
      const contents =
        typeof message.content === "string"
          ? [{ type: "text" as const, text: message.content }]
          : message.content;
      for (const content of contents) {
        if (content.type === "text") {
          const entry: StudioTranscriptEntry = {
            entryId: transcript.length,
            kind: "message",
            role: "user",
            text: content.text,
          };
          if (!textEntryAdded && attachments.length > 0) entry.attachments = attachments;
          transcript.push(entry);
          textEntryAdded = true;
        }
      }
      if (!textEntryAdded && attachments.length > 0) {
        const entry: StudioTranscriptEntry = {
          entryId: transcript.length,
          kind: "message",
          role: "user",
          text: "",
          attachments,
        };
        transcript.push(entry);
      }
      continue;
    }
    if (message.role === "tool") {
      for (const content of message.content) {
        if (content.type !== "tool-result") {
          continue;
        }
        const entry: Extract<StudioTranscriptEntry, { kind: "tool" }> = {
          entryId: transcript.length,
          kind: "tool",
          toolName: content.toolName,
          callId: content.callId ?? content.toolCallId,
          result: toolResultText(content.output),
        };
        if (content.output.type === "content") entry.structuredResult = content.output.value;
        transcript.push(entry);
      }
      continue;
    }

    const contents =
      typeof message.content === "string"
        ? [{ type: "text" as const, text: message.content }]
        : message.content;
    for (const content of contents) {
      if (content.type === "text") {
        appendAssistantTranscriptText(transcript, content.text);
      } else if (content.type === "reasoning") {
        const entry: StudioTranscriptEntry = {
          entryId: transcript.length,
          kind: "reasoning",
          text: content.text,
        };
        if (content.id !== undefined) entry.reasoningId = content.id;
        transcript.push(entry);
      } else if (content.type === "tool-call") {
        transcript.push({
          entryId: transcript.length,
          kind: "tool",
          toolName: content.toolName,
          callId: content.callId ?? content.toolCallId,
          args: formatJson(content.input),
        });
      }
    }
  }
  return transcript;
}

function attachmentsFromMessage(message: Message): StudioTranscriptAttachment[] {
  if (message.role !== "user" && message.role !== "assistant") {
    return [];
  }
  if (typeof message.content === "string") return [];
  return message.content.flatMap((content): StudioTranscriptAttachment[] => {
    if (content.type === "image") {
      const attachment: StudioTranscriptAttachment = { kind: "image" };
      if (content.image.type === "data") {
        attachment.data = content.image.data;
        if (content.mediaType !== undefined) attachment.mediaType = content.mediaType;
      } else {
        attachment.url = content.image.url;
      }
      return [attachment];
    }
    if (content.type === "file") {
      const attachment: StudioTranscriptAttachment = { kind: "document" };
      if (content.filename !== undefined) attachment.name = content.filename;
      attachment.mediaType = content.mediaType;
      if (content.data.type === "data") attachment.data = content.data.data;
      if (content.data.type === "url") attachment.url = content.data.url;
      return [attachment];
    }
    return [];
  });
}

function toolResultText(output: ToolResultOutput): string {
  if (output.type === "text" || output.type === "error-text") return output.value;
  if (output.type === "json" || output.type === "error-json") return formatJson(output.value);
  if (output.type === "execution-denied") return output.reason ?? "Execution denied";
  return output.value
    .map((part) =>
      part.type === "text"
        ? part.text
        : `[file:${part.mediaType}${part.filename === undefined ? "" : `:${part.filename}`}]`,
    )
    .join("\n");
}

function appendAssistantTranscriptText(transcript: StudioTranscriptEntry[], text: string): void {
  const last = transcript.at(-1);
  if (last?.kind === "message" && last.role === "assistant") {
    last.text = `${last.text}${text}`;
    return;
  }
  transcript.push({
    entryId: transcript.length,
    kind: "message",
    role: "assistant",
    text,
  });
}
