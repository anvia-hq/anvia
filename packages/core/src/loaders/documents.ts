import type { Document } from "../completion";
import type { FileReadWithPath, PdfPageWithPath, PdfReadWithPath } from "./types";

export function fileToDocument(file: FileReadWithPath): Document {
  return {
    id: file.path,
    text: file.text,
    additionalProps: {
      source: file.path,
      mediaType: "text/plain",
    },
  };
}

export async function fileLoaderToDocuments(
  loader: AsyncIterable<FileReadWithPath>,
): Promise<Document[]> {
  const documents: Document[] = [];
  for await (const file of loader) {
    documents.push(fileToDocument(file));
  }
  return documents;
}

export function pdfToDocument(pdf: PdfReadWithPath): Document {
  return {
    id: pdf.path,
    text: pdf.text,
    additionalProps: {
      source: pdf.path,
      mediaType: "application/pdf",
    },
  };
}

export async function pdfLoaderToDocuments(
  loader: AsyncIterable<PdfReadWithPath>,
): Promise<Document[]> {
  const documents: Document[] = [];
  for await (const pdf of loader) {
    documents.push(pdfToDocument(pdf));
  }
  return documents;
}

export function pdfPageToDocument(page: PdfPageWithPath): Document {
  return {
    id: `${page.path}#page=${page.pageNumber}`,
    text: page.text,
    additionalProps: {
      source: page.path,
      mediaType: "application/pdf",
      pageNumber: String(page.pageNumber),
    },
  };
}

export async function pdfPageLoaderToDocuments(
  loader: AsyncIterable<PdfPageWithPath>,
): Promise<Document[]> {
  const documents: Document[] = [];
  for await (const page of loader) {
    documents.push(pdfPageToDocument(page));
  }
  return documents;
}
