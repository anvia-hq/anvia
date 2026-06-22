import { describe, expect, it } from "vitest";
import { MISTRAL_OCR_LATEST, MistralClient } from "../src/index";

describe("Mistral OCR models", () => {
  it("maps document URL OCR requests", async () => {
    const calls: unknown[] = [];
    const client = new MistralClient({
      client: {
        ocr: {
          process: async (params: unknown) => {
            calls.push(params);
            return ocrResponse();
          },
        },
      } as never,
    });

    const response = await client.ocrModel().ocr({
      source: {
        type: "document_url",
        url: "https://example.com/invoice.pdf",
        documentName: "invoice.pdf",
      },
      pages: "0-2",
      includeImageBase64: true,
      tableFormat: "markdown",
      extractHeader: true,
      confidenceScoresGranularity: "page",
      additionalParams: { imageLimit: 4, ignored: "kept" },
    });

    expect(calls).toEqual([
      {
        model: MISTRAL_OCR_LATEST,
        document: {
          type: "document_url",
          documentUrl: "https://example.com/invoice.pdf",
          documentName: "invoice.pdf",
        },
        imageLimit: 4,
        ignored: "kept",
        pages: "0-2",
        includeImageBase64: true,
        tableFormat: "markdown",
        extractHeader: true,
        confidenceScoresGranularity: "page",
      },
    ]);
    expect(response.markdown).toBe("# Page 1\n\n# Page 2");
    expect(response.text).toBe("# Page 1\n\n# Page 2");
    expect(response.pages).toEqual([
      {
        index: 0,
        markdown: "# Page 1",
        images: [],
        dimensions: { width: 100, height: 200 },
      },
      {
        index: 1,
        markdown: "# Page 2",
        images: [{ id: "image-1" }],
        tables: [{ rows: 2 }],
        hyperlinks: ["https://example.com"],
        header: "Header",
        footer: "Footer",
        dimensions: null,
        confidenceScores: { page: 0.98 },
      },
    ]);
    expect(response.model).toBe("mistral-ocr-latest");
    expect(response.usageInfo).toEqual({ pagesProcessed: 2, docSizeBytes: 1234 });
    expect(response.rawResponse).toEqual(ocrResponse());
  });

  it("does not allow additional params to override OCR model or document", async () => {
    const calls: unknown[] = [];
    const client = new MistralClient({
      client: {
        ocr: {
          process: async (params: unknown) => {
            calls.push(params);
            return { pages: [] };
          },
        },
      } as never,
    });

    await client.ocrModel("custom-ocr").ocr({
      source: { type: "file_id", fileId: "file-123" },
      additionalParams: {
        model: "unsafe-model",
        document: { type: "document_url", documentUrl: "https://example.com/unsafe.pdf" },
        includeImageBase64: true,
      },
    });

    expect(calls).toEqual([
      {
        model: "custom-ocr",
        document: {
          type: "file",
          fileId: "file-123",
        },
        includeImageBase64: true,
      },
    ]);
  });

  it("maps image URL and file id OCR requests", async () => {
    const calls: unknown[] = [];
    const client = new MistralClient({
      client: {
        ocr: {
          process: async (params: unknown) => {
            calls.push(params);
            return { pages: [] };
          },
        },
      } as never,
    });

    await client.ocrModel("custom-ocr").ocr({
      source: { type: "image_url", url: "https://example.com/page.png" },
    });
    await client.ocrModel("custom-ocr").ocr({
      source: { type: "file_id", fileId: "file-123" },
    });

    expect(calls).toEqual([
      {
        model: "custom-ocr",
        document: {
          type: "image_url",
          imageUrl: "https://example.com/page.png",
        },
      },
      {
        model: "custom-ocr",
        document: {
          type: "file",
          fileId: "file-123",
        },
      },
    ]);
  });

  it("uploads byte sources before running OCR and keeps upload metadata", async () => {
    const uploads: unknown[] = [];
    const ocrCalls: unknown[] = [];
    const client = new MistralClient({
      client: {
        files: {
          upload: async (params: unknown) => {
            uploads.push(params);
            return {
              id: "uploaded-file",
              filename: "scan.pdf",
              sizeBytes: 3,
              purpose: "ocr",
            };
          },
        },
        ocr: {
          process: async (params: unknown) => {
            ocrCalls.push(params);
            return ocrResponse();
          },
        },
      } as never,
    });

    const response = await client.ocrModel().ocr({
      source: {
        type: "bytes",
        data: new Uint8Array([1, 2, 3]),
        filename: "scan.pdf",
        expiry: 3600,
        visibility: "user",
      },
    });

    expect(uploads).toEqual([
      {
        file: {
          content: new Uint8Array([1, 2, 3]),
          fileName: "scan.pdf",
        },
        purpose: "ocr",
        expiry: 3600,
        visibility: "user",
      },
    ]);
    expect(ocrCalls).toEqual([
      {
        model: MISTRAL_OCR_LATEST,
        document: {
          type: "file",
          fileId: "uploaded-file",
        },
      },
    ]);
    expect(response.uploadedFile).toEqual({
      id: "uploaded-file",
      filename: "scan.pdf",
      sizeBytes: 3,
      purpose: "ocr",
      rawResponse: {
        id: "uploaded-file",
        filename: "scan.pdf",
        sizeBytes: 3,
        purpose: "ocr",
      },
    });
  });

  it("rejects empty byte sources before uploading", async () => {
    const client = new MistralClient({
      client: {
        files: {
          upload: async () => {
            throw new Error("The provider should not be called for empty input.");
          },
        },
        ocr: {
          process: async () => {
            throw new Error("The provider should not be called for empty input.");
          },
        },
      } as never,
    });

    await expect(
      client.ocrModel().ocr({
        source: { type: "bytes", data: new Uint8Array(), filename: "empty.pdf" },
      }),
    ).rejects.toThrow("Mistral OCR byte source cannot be empty.");
  });
});

function ocrResponse() {
  return {
    model: "mistral-ocr-latest",
    pages: [
      {
        index: 0,
        markdown: "# Page 1",
        images: [],
        dimensions: { width: 100, height: 200 },
      },
      {
        index: 1,
        markdown: "# Page 2",
        images: [{ id: "image-1" }],
        tables: [{ rows: 2 }],
        hyperlinks: ["https://example.com"],
        header: "Header",
        footer: "Footer",
        dimensions: null,
        confidenceScores: { page: 0.98 },
      },
    ],
    usageInfo: { pagesProcessed: 2, docSizeBytes: 1234 },
  };
}
