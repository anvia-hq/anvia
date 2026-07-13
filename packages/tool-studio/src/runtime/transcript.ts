import type { Message } from "@anvia/core/completion";
import type { StudioTranscriptAttachment, StudioTranscriptEntry } from "../types";
import { formatJson } from "./json";

export function renumberTranscript(entries: StudioTranscriptEntry[]): StudioTranscriptEntry[] {
  return entries.map((entry, entryId) => ({ ...entry, entryId }));
}

export function transcriptFromMessages(messages: Message[]): StudioTranscriptEntry[] {
  const transcript: StudioTranscriptEntry[] = [];
  for (const message of messages) {
    if (message.role === "system") {
      continue;
    }
    if (message.role === "user") {
      const attachments = attachmentsFromMessage(message);
      let textEntryAdded = false;
      for (const content of message.content) {
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
        transcript.push({
          entryId: transcript.length,
          kind: "message",
          role: "user",
          text: "",
          attachments,
        });
      }
      continue;
    }
    if (message.role === "tool") {
      for (const content of message.content) {
        transcript.push({
          entryId: transcript.length,
          kind: "tool",
          toolName: "tool_result",
          callId: content.callId ?? content.id,
          result: content.content
            .map((item) =>
              "text" in item ? item.text : `[image:${item.mediaType ?? "image/png"}]`,
            )
            .join("\n"),
          structuredResult: content.content,
        });
      }
      continue;
    }

    for (const content of message.content) {
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
      } else if (content.type === "tool_call") {
        transcript.push({
          entryId: transcript.length,
          kind: "tool",
          toolName: content.function.name,
          callId: content.callId ?? content.id,
          args: formatJson(content.function.arguments),
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
  return message.content.flatMap((content): StudioTranscriptAttachment[] => {
    if (content.type === "image") {
      const attachment: StudioTranscriptAttachment = { kind: "image" };
      if (content.source.type === "base64") {
        attachment.data = content.source.data;
        attachment.mediaType = content.source.mediaType;
      } else {
        attachment.url = content.source.url;
      }
      return [attachment];
    }
    if (content.type === "document") {
      const attachment: StudioTranscriptAttachment = { kind: "document" };
      if (content.source.filename !== undefined) attachment.name = content.source.filename;
      if (content.source.mediaType !== undefined) attachment.mediaType = content.source.mediaType;
      if (content.source.type === "base64") attachment.data = content.source.data;
      if (content.source.type === "url") attachment.url = content.source.url;
      return [attachment];
    }
    return [];
  });
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
