import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  FileLoader,
  fileLoaderToDocuments,
  fileToDocument,
  PdfFileLoader,
  pdfPageLoaderToDocuments,
  pdfPageToDocument,
  pdfToDocument,
} from "../src/loaders";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "loaders");
const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("FileLoader", () => {
  it("reads UTF-8 files from a glob in stable order", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, "b.txt"), "bravo");
    await writeFile(join(dir, "a.txt"), "alpha");

    const outputs = await collect(FileLoader.withGlob(join(dir, "*.txt")).read().ignoreErrors());

    expect(outputs).toEqual(["alpha", "bravo"]);
  });

  it("reads only direct files from a directory", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, "top.txt"), "top");
    await mkdir(join(dir, "nested"));
    await writeFile(join(dir, "nested", "child.txt"), "nested");

    const outputs = await collect(FileLoader.withDir(dir).readWithPath().ignoreErrors());

    expect(outputs).toEqual([{ path: join(dir, "top.txt"), text: "top" }]);
  });

  it("reads bytes with <memory> path metadata", async () => {
    const [output] = await collect(
      FileLoader.fromBytes(new TextEncoder().encode("memory")).readWithPath(),
    );

    expect(output).toEqual({
      ok: true,
      value: { path: "<memory>", text: "memory" },
    });
    if (output?.ok !== true) {
      throw new Error("Expected successful memory file output");
    }
    expect(fileToDocument(output.value).additionalProps?.source).toBe("<memory>");
  });

  it("filters failed file reads when ignoreErrors is enabled", async () => {
    const dir = await tempDir();
    const denied = join(dir, "denied.txt");
    await writeFile(denied, "secret");
    await chmod(denied, 0);

    try {
      const outputs = await collect(FileLoader.withDir(dir).readWithPath().ignoreErrors());
      expect(outputs).toEqual([]);
    } finally {
      await chmod(denied, 0o600);
    }
  });

  it("converts successful file outputs to documents", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, "guide.txt"), "reset links expire");

    const documents = await fileLoaderToDocuments(
      FileLoader.withGlob(join(dir, "*.txt")).readWithPath().ignoreErrors(),
    );

    expect(documents).toEqual([
      {
        id: join(dir, "guide.txt"),
        text: "reset links expire",
        additionalProps: {
          source: join(dir, "guide.txt"),
          mediaType: "text/plain",
        },
      },
    ]);
  });
});

describe("PdfFileLoader", () => {
  it("extracts full PDF text", async () => {
    const [output] = await collect(PdfFileLoader.withGlob(join(fixtureDir, "dummy.pdf")).read());

    expect(output).toEqual({ ok: true, value: "Test PDF Document\n" });
    if (output?.ok !== true) {
      throw new Error("Expected successful PDF output");
    }
    expect(
      pdfToDocument({ path: "dummy.pdf", text: output.value }).additionalProps?.mediaType,
    ).toBe("application/pdf");
  });

  it("splits PDFs by zero-based page number", async () => {
    const pages = await collect(PdfFileLoader.withGlob(join(fixtureDir, "pages.pdf")).byPage());

    expect(pages).toEqual([
      { ok: true, value: { pageNumber: 0, text: "Page 1\n" } },
      { ok: true, value: { pageNumber: 1, text: "Page 2\n" } },
      { ok: true, value: { pageNumber: 2, text: "Page 3\n" } },
    ]);
  });

  it("preserves source path when page splitting readWithPath output", async () => {
    const path = join(fixtureDir, "pages.pdf");
    const pages = await collect(
      PdfFileLoader.withGlob(path).readWithPath().byPage().ignoreErrors(),
    );

    expect(pages).toEqual([
      { path, pageNumber: 0, text: "Page 1\n" },
      { path, pageNumber: 1, text: "Page 2\n" },
      { path, pageNumber: 2, text: "Page 3\n" },
    ]);
    const firstPage = pages[0];
    if (firstPage === undefined) {
      throw new Error("Expected at least one PDF page");
    }
    expect(pdfPageToDocument(firstPage).additionalProps).toEqual({
      source: path,
      mediaType: "application/pdf",
      pageNumber: "0",
    });
  });

  it("reads PDFs from memory and converts pages to documents", async () => {
    const bytes = await readFile(join(fixtureDir, "pages.pdf"));
    const documents = await pdfPageLoaderToDocuments(
      PdfFileLoader.fromBytes(bytes).readWithPath().byPage().ignoreErrors(),
    );

    expect(documents.map((document) => document.id)).toEqual([
      "<memory>#page=0",
      "<memory>#page=1",
      "<memory>#page=2",
    ]);
  });
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "anvia-loaders-"));
  tempDirs.push(dir);
  return dir;
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of iterable) {
    values.push(value);
  }
  return values;
}
