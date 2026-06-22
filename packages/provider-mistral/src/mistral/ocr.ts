import type { JsonValue } from "@anvia/core/completion";
import type { Mistral } from "@mistralai/mistralai";
import { isPlainObject } from "../utils";

export const MISTRAL_OCR_LATEST = "mistral-ocr-latest";

export type MistralOcrSource =
  | {
      type: "document_url";
      url: string;
      documentName?: string | undefined;
    }
  | {
      type: "image_url";
      url: string;
    }
  | {
      type: "file_id";
      fileId: string;
    }
  | {
      type: "bytes";
      data: Uint8Array | ArrayBuffer;
      filename: string;
      expiry?: number | null | undefined;
      visibility?: "workspace" | "user" | undefined;
    };

export type MistralOcrRequest = {
  source: MistralOcrSource;
  pages?: string | number[] | null | undefined;
  includeImageBase64?: boolean | null | undefined;
  imageLimit?: number | null | undefined;
  imageMinSize?: number | null | undefined;
  bboxAnnotationFormat?: JsonValue | null | undefined;
  documentAnnotationFormat?: JsonValue | null | undefined;
  documentAnnotationPrompt?: string | null | undefined;
  tableFormat?: "markdown" | "html" | null | undefined;
  extractHeader?: boolean | undefined;
  extractFooter?: boolean | undefined;
  confidenceScoresGranularity?: "word" | "page" | null | undefined;
  additionalParams?: JsonValue | undefined;
};

export type MistralOcrUploadedFile = {
  id: string;
  filename?: string | undefined;
  sizeBytes?: number | undefined;
  purpose?: string | undefined;
  rawResponse: unknown;
};

export type MistralOcrPage = {
  index: number;
  markdown: string;
  images: unknown[];
  tables?: unknown[] | undefined;
  hyperlinks?: string[] | undefined;
  header?: string | null | undefined;
  footer?: string | null | undefined;
  dimensions?: unknown;
  confidenceScores?: unknown;
};

export type MistralOcrResponse<RawResponse = unknown> = {
  text: string;
  markdown: string;
  pages: MistralOcrPage[];
  model?: string | undefined;
  usageInfo?: unknown;
  documentAnnotation?: string | null | undefined;
  uploadedFile?: MistralOcrUploadedFile | undefined;
  rawResponse: RawResponse;
};

export class MistralOcrModel {
  readonly provider = "mistral";

  constructor(
    private readonly client: Mistral,
    readonly defaultModel = MISTRAL_OCR_LATEST,
  ) {}

  async ocr(request: MistralOcrRequest): Promise<MistralOcrResponse<unknown>> {
    const { document, uploadedFile } = await this.documentFromSource(request.source);
    const params = this.toOcrParams(request, document);
    const response = await this.client.ocr.process(params as never);

    return normalizeOcrResponse(response, uploadedFile);
  }

  private async documentFromSource(
    source: MistralOcrSource,
  ): Promise<{ document: Record<string, unknown>; uploadedFile?: MistralOcrUploadedFile }> {
    if (source.type === "document_url") {
      return {
        document: {
          type: "document_url",
          documentUrl: source.url,
          ...(source.documentName !== undefined ? { documentName: source.documentName } : {}),
        },
      };
    }

    if (source.type === "image_url") {
      return {
        document: {
          type: "image_url",
          imageUrl: source.url,
        },
      };
    }

    if (source.type === "file_id") {
      return {
        document: {
          type: "file",
          fileId: source.fileId,
        },
      };
    }

    const data = toUint8Array(source.data);
    if (data.byteLength === 0) {
      throw new Error("Mistral OCR byte source cannot be empty.");
    }
    if (source.filename.length === 0) {
      throw new Error("Mistral OCR byte source filename cannot be empty.");
    }

    const uploadParams: Record<string, unknown> = {
      file: {
        content: data,
        fileName: source.filename,
      },
      purpose: "ocr",
    };
    if (source.expiry !== undefined) uploadParams.expiry = source.expiry;
    if (source.visibility !== undefined) uploadParams.visibility = source.visibility;

    const uploadResponse = await this.client.files.upload(uploadParams as never);
    const uploadedFile = uploadedFileFromResponse(uploadResponse);

    return {
      document: {
        type: "file",
        fileId: uploadedFile.id,
      },
      uploadedFile,
    };
  }

  private toOcrParams(request: MistralOcrRequest, document: Record<string, unknown>) {
    const params: Record<string, unknown> = {
      model: this.defaultModel,
      document,
    };

    if (request.additionalParams !== undefined && isPlainObject(request.additionalParams)) {
      const additionalParams = { ...request.additionalParams };
      delete additionalParams.model;
      delete additionalParams.document;
      Object.assign(params, additionalParams);
    }

    if (request.pages !== undefined) params.pages = request.pages;
    if (request.includeImageBase64 !== undefined) {
      params.includeImageBase64 = request.includeImageBase64;
    }
    if (request.imageLimit !== undefined) params.imageLimit = request.imageLimit;
    if (request.imageMinSize !== undefined) params.imageMinSize = request.imageMinSize;
    if (request.bboxAnnotationFormat !== undefined) {
      params.bboxAnnotationFormat = request.bboxAnnotationFormat;
    }
    if (request.documentAnnotationFormat !== undefined) {
      params.documentAnnotationFormat = request.documentAnnotationFormat;
    }
    if (request.documentAnnotationPrompt !== undefined) {
      params.documentAnnotationPrompt = request.documentAnnotationPrompt;
    }
    if (request.tableFormat !== undefined) params.tableFormat = request.tableFormat;
    if (request.extractHeader !== undefined) params.extractHeader = request.extractHeader;
    if (request.extractFooter !== undefined) params.extractFooter = request.extractFooter;
    if (request.confidenceScoresGranularity !== undefined) {
      params.confidenceScoresGranularity = request.confidenceScoresGranularity;
    }

    return params;
  }
}

function normalizeOcrResponse(
  response: unknown,
  uploadedFile: MistralOcrUploadedFile | undefined,
): MistralOcrResponse<unknown> {
  const raw = isPlainObject(response) ? response : {};
  const pages = Array.isArray(raw.pages) ? raw.pages.map(normalizeOcrPage) : [];
  const markdown = pages.map((page) => page.markdown).join("\n\n");

  return {
    text: markdown,
    markdown,
    pages,
    ...(typeof raw.model === "string" ? { model: raw.model } : {}),
    ...(raw.usageInfo !== undefined ? { usageInfo: raw.usageInfo } : {}),
    ...(typeof raw.documentAnnotation === "string" || raw.documentAnnotation === null
      ? { documentAnnotation: raw.documentAnnotation }
      : {}),
    ...(uploadedFile !== undefined ? { uploadedFile } : {}),
    rawResponse: response,
  };
}

function normalizeOcrPage(page: unknown): MistralOcrPage {
  const raw = isPlainObject(page) ? page : {};
  return {
    index: typeof raw.index === "number" ? raw.index : 0,
    markdown: typeof raw.markdown === "string" ? raw.markdown : "",
    images: Array.isArray(raw.images) ? raw.images : [],
    ...(Array.isArray(raw.tables) ? { tables: raw.tables } : {}),
    ...(isStringArray(raw.hyperlinks) ? { hyperlinks: raw.hyperlinks } : {}),
    ...(typeof raw.header === "string" || raw.header === null ? { header: raw.header } : {}),
    ...(typeof raw.footer === "string" || raw.footer === null ? { footer: raw.footer } : {}),
    ...(raw.dimensions !== undefined ? { dimensions: raw.dimensions } : {}),
    ...(raw.confidenceScores !== undefined ? { confidenceScores: raw.confidenceScores } : {}),
  };
}

function uploadedFileFromResponse(response: unknown): MistralOcrUploadedFile {
  if (!isPlainObject(response) || typeof response.id !== "string") {
    throw new Error("Mistral OCR upload response contained no file id.");
  }

  return {
    id: response.id,
    ...(typeof response.filename === "string" ? { filename: response.filename } : {}),
    ...(typeof response.sizeBytes === "number" ? { sizeBytes: response.sizeBytes } : {}),
    ...(typeof response.purpose === "string" ? { purpose: response.purpose } : {}),
    rawResponse: response,
  };
}

function toUint8Array(data: Uint8Array | ArrayBuffer): Uint8Array {
  if (data instanceof Uint8Array) {
    return new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
  }

  return new Uint8Array(data);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
