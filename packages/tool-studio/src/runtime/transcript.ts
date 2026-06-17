import type { Message } from "@anvia/core/completion";
import type { StudioTranscriptAttachment, StudioTranscriptEntry } from "../types";

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
          transcript.push({
            entryId: transcript.length,
            kind: "message",
            role: "user",
            text: content.text,
            ...(attachments.length === 0 ? {} : { attachments }),
          });
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
        transcript.push({
          entryId: transcript.length,
          kind: "reasoning",
          ...(content.id === undefined ? {} : { reasoningId: content.id }),
          text: content.text,
        });
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
      return [
        {
          kind: "image",
          ...(content.source.type === "base64"
            ? { data: content.source.data, mediaType: content.source.mediaType }
            : { url: content.source.url }),
        },
      ];
    }
    if (content.type === "document") {
      return [
        {
          kind: "document",
          ...(content.source.filename === undefined ? {} : { name: content.source.filename }),
          ...(content.source.mediaType === undefined
            ? {}
            : { mediaType: content.source.mediaType }),
          ...(content.source.type === "base64"
            ? { data: content.source.data }
            : content.source.type === "url"
              ? { url: content.source.url }
              : {}),
        },
      ];
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

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
