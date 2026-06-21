import type { Message, UserContent } from "@anvia/core/completion";
import type {
  StudioModelSummary,
  StudioPipelineLogEntry,
  StudioSession,
  StudioTraceSummary,
} from "../../types";
import type { TranscriptEntry } from "./modules/shared/types";

export const studioModelMetadataKey = "studioModel";
export const supportedAttachmentTypes = ".png,.jpg,.jpeg,.webp,.gif,.pdf,.txt,.md,.csv,.json";

export type PromptAttachment = {
  id: string;
  name: string;
  mediaType: string;
  kind: "image" | "document";
  data: string;
  size: number;
};

export type StudioAgentRunRequest = {
  agentId: string;
  message: string | Message;
  sessionId?: string;
  history?: Message[];
  model?: string;
  stream: true;
  metadata: {
    source: string;
    studioModel?: string;
  };
};

export function isPipelineLogEvent(event: unknown): event is {
  type: "pipeline_log";
  log: StudioPipelineLogEntry;
} {
  return isRecord(event) && event.type === "pipeline_log" && isRecord(event.log);
}

export function isPipelineFinalEvent(event: unknown): event is {
  type: "pipeline_final";
  output: unknown;
} {
  return isRecord(event) && event.type === "pipeline_final" && "output" in event;
}

export function isErrorStreamEvent(event: unknown): event is {
  type: "error";
  error: unknown;
} {
  return isRecord(event) && event.type === "error";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function enrichTranscriptWithTraceIds(
  transcript: TranscriptEntry[],
  traceSummaries: StudioTraceSummary[],
): TranscriptEntry[] {
  const sortedTraceIds = [...traceSummaries]
    .sort((left, right) => Date.parse(left.startedAt) - Date.parse(right.startedAt))
    .map((trace) => trace.id);
  let traceIndex = 0;
  let pendingAssistantIndex: number | undefined;
  const next = transcript.map((entry) =>
    entry.kind === "message" && entry.role === "assistant" ? withoutTraceId(entry) : entry,
  );

  function assignPendingTraceId() {
    if (pendingAssistantIndex === undefined) {
      return;
    }
    const traceId = sortedTraceIds[traceIndex];
    traceIndex += 1;
    if (traceId !== undefined) {
      const entry = next[pendingAssistantIndex];
      next[pendingAssistantIndex] = { ...entry, traceId } as TranscriptEntry;
    }
    pendingAssistantIndex = undefined;
  }

  for (const [index, entry] of next.entries()) {
    if (entry.kind === "message" && entry.role === "user") {
      assignPendingTraceId();
      continue;
    }
    if (entry.kind === "message" && entry.role === "assistant") {
      pendingAssistantIndex = index;
    }
  }
  assignPendingTraceId();

  return next;
}

function withoutTraceId(entry: Extract<TranscriptEntry, { kind: "message" }>): TranscriptEntry {
  const { traceId: _traceId, ...rest } = entry;
  return rest;
}

export function sessionModelRef(session: StudioSession): string {
  const value = session.metadata?.[studioModelMetadataKey];
  return typeof value === "string" ? value : "";
}

export function modelRefAvailable(models: StudioModelSummary[], ref: string): boolean {
  return ref.length > 0 && models.some((model) => model.ref === ref);
}

export function modelSelectLabel(model: StudioModelSummary): string {
  const provider = model.providerName ?? model.providerId;
  const name = model.name ?? model.id;
  const modalities = model.modalities?.input
    .filter((modality) => modality !== "text")
    .map((modality) => modality.slice(0, 3))
    .join("/");
  return modalities === undefined || modalities.length === 0
    ? `${provider} / ${name}`
    : `${provider} / ${name} (${modalities})`;
}

export async function fileToAttachment(file: File): Promise<PromptAttachment> {
  const mediaType = file.type || mediaTypeFromName(file.name);
  const kind = mediaType.startsWith("image/") ? "image" : "document";
  if (!isSupportedAttachment(mediaType, file.name)) {
    throw new Error(`Unsupported attachment type: ${file.name}`);
  }
  return {
    id: globalThis.crypto.randomUUID(),
    name: file.name,
    mediaType,
    kind,
    data: await fileToBase64(file),
    size: file.size,
  };
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error(`Failed to read ${file.name}`));
    reader.onload = () => {
      const value = reader.result;
      if (typeof value !== "string") {
        reject(new Error(`Failed to read ${file.name}`));
        return;
      }
      resolve(value.slice(value.indexOf(",") + 1));
    };
    reader.readAsDataURL(file);
  });
}

export function userMessageWithAttachments(text: string, attachments: PromptAttachment[]): Message {
  const content: UserContent[] = [];
  if (text.length > 0) {
    content.push({ type: "text", text });
  }
  for (const attachment of attachments) {
    if (attachment.kind === "image") {
      content.push({
        type: "image",
        source: {
          type: "base64",
          data: attachment.data,
          mediaType: attachment.mediaType,
        },
      });
      continue;
    }
    content.push({
      type: "document",
      source: {
        type: "base64",
        data: attachment.data,
        mediaType: attachment.mediaType,
        filename: attachment.name,
      },
    });
  }
  return { role: "user", content };
}

export function transcriptAttachmentsForPrompt(
  attachments: PromptAttachment[],
): NonNullable<Extract<TranscriptEntry, { kind: "message" }>["attachments"]> {
  return attachments.map((attachment) => ({
    kind: attachment.kind,
    name: attachment.name,
    mediaType: attachment.mediaType,
    data: attachment.data,
  }));
}

function isSupportedAttachment(mediaType: string, name: string): boolean {
  return (
    mediaType.startsWith("image/") ||
    mediaType === "application/pdf" ||
    mediaType.startsWith("text/") ||
    ["application/json", "text/markdown", "text/csv"].includes(mediaType) ||
    /\.(md|csv|json|txt)$/i.test(name)
  );
}

function mediaTypeFromName(name: string): string {
  if (/\.png$/i.test(name)) return "image/png";
  if (/\.jpe?g$/i.test(name)) return "image/jpeg";
  if (/\.webp$/i.test(name)) return "image/webp";
  if (/\.gif$/i.test(name)) return "image/gif";
  if (/\.pdf$/i.test(name)) return "application/pdf";
  if (/\.md$/i.test(name)) return "text/markdown";
  if (/\.csv$/i.test(name)) return "text/csv";
  if (/\.json$/i.test(name)) return "application/json";
  return "text/plain";
}
