import { beforeEach, describe, expect, it, vi } from "vitest";
import { extractPdfText } from "../src/documents";

const pdfjs = vi.hoisted(() => ({
  getDocument: vi.fn(),
}));

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => pdfjs);

beforeEach(() => {
  pdfjs.getDocument.mockReset();
});

describe("extractPdfText lifecycle", () => {
  it("copies caller-owned bytes and destroys the loading task after success", async () => {
    const destroy = vi.fn(async () => undefined);
    const input = new Uint8Array([1, 2, 3]);
    let parserData: Uint8Array | undefined;
    pdfjs.getDocument.mockImplementation(({ data }: { data: Uint8Array }) => {
      parserData = data;
      return loadingTask({ destroy });
    });

    const result = await extractPdfText({ data: input });
    input.fill(9);

    expect(result).toEqual({ pages: [{ pageNumber: 1, text: "first\nsecond" }] });
    expect(parserData).not.toBe(input);
    expect(parserData).toEqual(new Uint8Array([1, 2, 3]));
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("skips marked content and rejects malformed text values without coercion", async () => {
    const successfulDestroy = vi.fn(async () => undefined);
    pdfjs.getDocument.mockReturnValueOnce(
      loadingTask({
        destroy: successfulDestroy,
        items: [
          { type: "beginMarkedContent" },
          { str: "valid", hasEOL: false },
          { type: "endMarkedContent" },
        ],
      }),
    );

    await expect(extractPdfText({ data: new Uint8Array([1]) })).resolves.toEqual({
      pages: [{ pageNumber: 1, text: "valid" }],
    });
    expect(successfulDestroy).toHaveBeenCalledTimes(1);

    const failedDestroy = vi.fn(async () => undefined);
    pdfjs.getDocument.mockReturnValueOnce(
      loadingTask({ destroy: failedDestroy, items: [{ str: 42, hasEOL: false }] }),
    );

    await expect(extractPdfText({ data: new Uint8Array([1]) })).rejects.toThrow(TypeError);
    expect(failedDestroy).toHaveBeenCalledTimes(1);

    const unknownItemDestroy = vi.fn(async () => undefined);
    pdfjs.getDocument.mockReturnValueOnce(
      loadingTask({ destroy: unknownItemDestroy, items: [{ unexpected: true }] }),
    );

    await expect(extractPdfText({ data: new Uint8Array([1]) })).rejects.toThrow(TypeError);
    expect(unknownItemDestroy).toHaveBeenCalledTimes(1);
  });

  it("destroys the loading task when document loading fails", async () => {
    const destroy = vi.fn(async () => undefined);
    const failure = new Error("invalid PDF");
    pdfjs.getDocument.mockReturnValue({
      promise: Promise.reject(failure),
      destroy,
    });

    await expect(extractPdfText({ data: new Uint8Array([1]) })).rejects.toBe(failure);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("surfaces a cleanup failure after successful extraction", async () => {
    const cleanupError = new Error("cleanup failed");
    const destroy = vi.fn(async () => {
      throw cleanupError;
    });
    pdfjs.getDocument.mockReturnValue(loadingTask({ destroy }));

    await expect(extractPdfText({ data: new Uint8Array([1]) })).rejects.toBe(cleanupError);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("preserves parsing and cleanup failures together", async () => {
    const parsingError = new Error("parsing failed");
    const cleanupError = new Error("cleanup failed");
    const destroy = vi.fn(async () => {
      throw cleanupError;
    });
    pdfjs.getDocument.mockReturnValue({
      promise: Promise.reject(parsingError),
      destroy,
    });

    await expect(extractPdfText({ data: new Uint8Array([1]) })).rejects.toMatchObject({
      cause: parsingError,
      errors: [parsingError, cleanupError],
    });
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("propagates mid-operation abort and destroys the loading task once", async () => {
    const destroy = vi.fn(async () => undefined);
    const getPage = vi.fn(() => new Promise<never>(() => undefined));
    pdfjs.getDocument.mockReturnValue({
      promise: Promise.resolve({ numPages: 1, getPage }),
      destroy,
    });
    const controller = new AbortController();
    const reason = new Error("cancelled");

    const extraction = extractPdfText({
      data: new Uint8Array([1]),
      abortSignal: controller.signal,
    });
    await vi.waitFor(() => expect(getPage).toHaveBeenCalledTimes(1));
    controller.abort(reason);

    await expect(extraction).rejects.toBe(reason);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("preserves abort and cleanup failures together", async () => {
    const cleanupError = new Error("cleanup failed");
    const destroy = vi.fn(async () => {
      throw cleanupError;
    });
    const getPage = vi.fn(() => new Promise<never>(() => undefined));
    pdfjs.getDocument.mockReturnValue({
      promise: Promise.resolve({ numPages: 1, getPage }),
      destroy,
    });
    const controller = new AbortController();
    const abortReason = new Error("cancelled");

    const extraction = extractPdfText({
      data: new Uint8Array([1]),
      abortSignal: controller.signal,
    });
    await vi.waitFor(() => expect(getPage).toHaveBeenCalledTimes(1));
    controller.abort(abortReason);

    await expect(extraction).rejects.toMatchObject({
      cause: abortReason,
      errors: [abortReason, cleanupError],
    });
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});

function loadingTask({
  destroy,
  items = [
    { str: "first", hasEOL: true },
    { str: "second", hasEOL: false },
  ],
}: {
  destroy: () => Promise<void>;
  items?: readonly unknown[];
}) {
  return {
    promise: Promise.resolve({
      numPages: 1,
      getPage: async () => ({
        getTextContent: async () => ({ items }),
      }),
    }),
    destroy,
  };
}
