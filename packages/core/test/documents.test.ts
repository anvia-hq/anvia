import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { chunkText, extractPdfText } from "../src/documents";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "loaders");

describe("chunkText", () => {
  it("creates deterministic fixed chunks with overlap and exact offsets", () => {
    const source = "abcdefghij";
    const chunks = chunkText({
      text: source,
      strategy: "fixed",
      maxSize: 4,
      overlap: 1,
    });

    expect(chunks).toEqual([
      { index: 0, text: "abcd", start: 0, end: 4 },
      { index: 1, text: "defg", start: 3, end: 7 },
      { index: 2, text: "ghij", start: 6, end: 10 },
    ]);
    for (const chunk of chunks) {
      expect(chunk.text).toBe(source.slice(chunk.start, chunk.end));
      expect(chunk.text.length).toBeLessThanOrEqual(4);
    }
  });

  it("returns no chunks for empty input after validating options", () => {
    expect(chunkText({ text: "", strategy: "fixed", maxSize: 4 })).toEqual([]);
    expect(() => chunkText({ text: "", strategy: "fixed", maxSize: 0 })).toThrow(RangeError);
  });

  it("uses recursive separator priority and retains separators", () => {
    expect(
      chunkText({
        text: "aa bb\ncc dd",
        strategy: "recursive",
        maxSize: 5,
        separators: ["\n", " "],
      }),
    ).toEqual([
      { index: 0, text: "aa ", start: 0, end: 3 },
      { index: 1, text: "bb\n", start: 3, end: 6 },
      { index: 2, text: "cc dd", start: 6, end: 11 },
    ]);
  });

  it("packs adjacent recursive sections and applies overlap within maxSize", () => {
    const source = "a b c d";
    const chunks = chunkText({
      text: source,
      strategy: "recursive",
      maxSize: 5,
      overlap: 2,
      separators: [" "],
    });

    expect(chunks).toEqual([
      { index: 0, text: "a b ", start: 0, end: 4 },
      { index: 1, text: "b c d", start: 2, end: 7 },
    ]);
    for (const chunk of chunks) {
      expect(chunk.text).toBe(source.slice(chunk.start, chunk.end));
      expect(chunk.text.length).toBeLessThanOrEqual(5);
    }
  });

  it("keeps recursive offsets valid when an early section is shorter than overlap", () => {
    const source = "a abcdefghij";
    const chunks = chunkText({
      text: source,
      strategy: "recursive",
      maxSize: 5,
      overlap: 4,
      separators: [" "],
    });

    expect(chunks[0]).toEqual({ index: 0, text: "a ", start: 0, end: 2 });
    expect(chunks.at(-1)?.end).toBe(source.length);
    for (const chunk of chunks) {
      expect(chunk.start).toBeGreaterThanOrEqual(0);
      expect(chunk.end).toBeGreaterThan(chunk.start);
      expect(chunk.text).toBe(source.slice(chunk.start, chunk.end));
      expect(chunk.text.length).toBeLessThanOrEqual(5);
    }
  });

  it("hard-splits recursive sections after exhausting separators", () => {
    expect(
      chunkText({
        text: "abcdefghij",
        strategy: "recursive",
        maxSize: 4,
        separators: ["\n", " "],
      }),
    ).toEqual([
      { index: 0, text: "abcd", start: 0, end: 4 },
      { index: 1, text: "efgh", start: 4, end: 8 },
      { index: 2, text: "ij", start: 8, end: 10 },
    ]);
  });

  it("rejects invalid strategies, sizes, overlaps, and strategy combinations", () => {
    expect(() => chunkText(null as never)).toThrow(TypeError);
    expect(() => chunkText({ text: 42, strategy: "fixed", maxSize: 4 } as never)).toThrow(
      TypeError,
    );
    expect(() => chunkText({ text: "text", strategy: "unknown", maxSize: 4 } as never)).toThrow(
      TypeError,
    );
    expect(() => chunkText({ text: "text", strategy: "fixed", maxSize: 0 })).toThrow(RangeError);
    expect(() => chunkText({ text: "text", strategy: "fixed", maxSize: 4, overlap: 4 })).toThrow(
      RangeError,
    );
    expect(() =>
      chunkText({
        text: "text",
        strategy: "fixed",
        maxSize: 4,
        separators: [" "],
      } as never),
    ).toThrow(TypeError);
  });

  it("rejects missing, empty, duplicate, and non-string recursive separators", () => {
    expect(() => chunkText({ text: "text", strategy: "recursive", maxSize: 4 } as never)).toThrow(
      TypeError,
    );
    expect(() =>
      chunkText({ text: "text", strategy: "recursive", maxSize: 4, separators: [] }),
    ).toThrow(TypeError);
    expect(() =>
      chunkText({ text: "text", strategy: "recursive", maxSize: 4, separators: [""] }),
    ).toThrow(TypeError);
    expect(() =>
      chunkText({ text: "text", strategy: "recursive", maxSize: 4, separators: [" ", " "] }),
    ).toThrow(TypeError);
    expect(() =>
      chunkText({
        text: "text",
        strategy: "recursive",
        maxSize: 4,
        separators: [1],
      } as never),
    ).toThrow(TypeError);
  });

  it("rejects invalid combinations at compile time", () => {
    if (Date.now() === Number.NEGATIVE_INFINITY) {
      // @ts-expect-error Fixed chunking does not accept separators.
      chunkText({ text: "text", strategy: "fixed", maxSize: 4, separators: [" "] });
      // @ts-expect-error Recursive chunking requires explicit separators.
      chunkText({ text: "text", strategy: "recursive", maxSize: 4 });
    }
  });
});

describe("extractPdfText", () => {
  it("extracts one-based PDF pages without invented trailing newlines", async () => {
    const data = new Uint8Array(await readFile(join(fixtureDir, "pages.pdf")));

    await expect(extractPdfText({ data })).resolves.toEqual({
      pages: [
        { pageNumber: 1, text: "Page 1" },
        { pageNumber: 2, text: "Page 2" },
        { pageNumber: 3, text: "Page 3" },
      ],
    });
  });

  it("rejects malformed PDF bytes", async () => {
    await expect(extractPdfText({ data: new Uint8Array([1, 2, 3]) })).rejects.toThrow();
  });

  it("propagates a signal aborted before parsing", async () => {
    const controller = new AbortController();
    const reason = new Error("stop parsing");
    controller.abort(reason);

    await expect(
      extractPdfText({ data: new Uint8Array([1]), abortSignal: controller.signal }),
    ).rejects.toBe(reason);
  });

  it("rejects invalid runtime inputs", async () => {
    await expect(extractPdfText(null as never)).rejects.toThrow(TypeError);
    await expect(extractPdfText({ data: new ArrayBuffer(1) } as never)).rejects.toThrow(TypeError);
    await expect(
      extractPdfText({ data: new Uint8Array([1]), abortSignal: {} as AbortSignal }),
    ).rejects.toThrow(TypeError);
  });

  it("publishes only the documents subpath", async () => {
    const packageJson = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as { exports: Record<string, unknown> };

    expect(packageJson.exports).toHaveProperty("./documents");
    expect(packageJson.exports).not.toHaveProperty("./loaders");
  });
});
