import { describe, expect, it, vi } from "vitest";
import { extractPdfText } from "../src/documents";

const missingDependency = Object.assign(
  new Error("Cannot find package 'pdfjs-dist' imported from documents/pdf.ts"),
  { code: "ERR_MODULE_NOT_FOUND" },
);

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => {
  throw missingDependency;
});

describe("extractPdfText optional dependency", () => {
  it("reports how to enable PDF extraction when pdfjs-dist is unavailable", async () => {
    await expect(extractPdfText({ data: new Uint8Array([1]) })).rejects.toThrow(
      'PDF extraction requires the optional "pdfjs-dist" package. Install it in your application to use extractPdfText().',
    );
  });
});
