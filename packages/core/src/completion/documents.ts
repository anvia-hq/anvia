import { type Document, Message, type Message as MessageType } from "./types";

export function normalizeDocuments(documents: Document[]): MessageType | undefined {
  if (documents.length === 0) {
    return undefined;
  }

  return Message.user(documents.map(formatDocument).join("\n"));
}

export function formatDocument(document: Document): string {
  return `<file id: ${document.id}>\n${formatDocumentBody(document)}\n</file>\n`;
}

function formatDocumentBody(document: Document): string {
  const metadata = formatMetadata(document.additionalProps);
  return metadata === undefined ? document.text : `${metadata}\n${document.text}`;
}

function formatMetadata(additionalProps: Record<string, string> | undefined): string | undefined {
  if (additionalProps === undefined) {
    return undefined;
  }

  const entries = Object.entries(additionalProps).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  if (entries.length === 0) {
    return undefined;
  }

  const metadata = entries.map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join(" ");
  return `<metadata ${metadata} />`;
}
