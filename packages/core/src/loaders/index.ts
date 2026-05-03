import { readdir, readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { glob } from "tinyglobby";
import type { Document } from "../completion";

export type LoaderResult<T> = { ok: true; value: T } | { ok: false; error: unknown };

export type FileSource = { path: string } | { path: "<memory>"; bytes: Uint8Array };
export type FileReadWithPath = { path: string; text: string };

export type PdfSource = { path: string } | { path: "<memory>"; bytes: Uint8Array };
export type PdfReadWithPath = { path: string; text: string };
export type PdfPage = { pageNumber: number; text: string };
export type PdfPageWithPath = { path: string; pageNumber: number; text: string };

type FileMode = "source" | "read" | "readWithPath";
type PdfMode = "source" | "read" | "readWithPath" | "byPage" | "byPageWithPath";

export class FileLoader<T = LoaderResult<FileSource>> implements AsyncIterable<T> {
  private constructor(
    private readonly source: () => AsyncIterable<LoaderResult<FileSource>>,
    private readonly mode: FileMode,
    private readonly skipErrors: boolean,
  ) {}

  static withGlob(pattern: string): FileLoader<LoaderResult<FileSource>> {
    return new FileLoader(
      async function* () {
        for (const path of await sortedGlob(pattern)) {
          yield ok({ path });
        }
      },
      "source",
      false,
    );
  }

  static withDir(directory: string): FileLoader<LoaderResult<FileSource>> {
    return new FileLoader(
      async function* () {
        const entries = await readdir(directory, { withFileTypes: true });
        const files = entries
          .filter((entry) => entry.isFile())
          .map((entry) => join(directory, entry.name))
          .sort((left, right) => left.localeCompare(right));
        for (const path of files) {
          yield ok({ path });
        }
      },
      "source",
      false,
    );
  }

  static fromBytes(bytes: Uint8Array | ArrayBuffer): FileLoader<LoaderResult<FileSource>> {
    return FileLoader.fromBytesMany([bytes]);
  }

  static fromBytesMany(
    bytes: Array<Uint8Array | ArrayBuffer>,
  ): FileLoader<LoaderResult<FileSource>> {
    return new FileLoader(
      async function* () {
        for (const value of bytes) {
          yield ok({ path: "<memory>", bytes: toUint8Array(value) });
        }
      },
      "source",
      false,
    );
  }

  read(): FileLoader<LoaderResult<string>> {
    return new FileLoader(this.source, "read", this.skipErrors);
  }

  readWithPath(): FileLoader<LoaderResult<FileReadWithPath>> {
    return new FileLoader(this.source, "readWithPath", this.skipErrors);
  }

  ignoreErrors(): FileLoader<UnwrapLoaderResult<T>> {
    return new FileLoader(this.source, this.mode, true) as FileLoader<UnwrapLoaderResult<T>>;
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    for await (const item of this.source()) {
      const result = await mapFileResult(item, this.mode);
      if (!result.ok && this.skipErrors) {
        continue;
      }
      yield (this.skipErrors && result.ok ? result.value : result) as T;
    }
  }
}

export class PdfFileLoader<T = LoaderResult<PdfSource>> implements AsyncIterable<T> {
  private constructor(
    private readonly source: () => AsyncIterable<LoaderResult<PdfSource>>,
    private readonly mode: PdfMode,
    private readonly skipErrors: boolean,
  ) {}

  static withGlob(pattern: string): PdfFileLoader<LoaderResult<PdfSource>> {
    return new PdfFileLoader(
      async function* () {
        for (const path of await sortedGlob(pattern)) {
          yield ok({ path });
        }
      },
      "source",
      false,
    );
  }

  static withDir(directory: string): PdfFileLoader<LoaderResult<PdfSource>> {
    return new PdfFileLoader(
      async function* () {
        const entries = await readdir(directory, { withFileTypes: true });
        const files = entries
          .filter((entry) => entry.isFile())
          .map((entry) => join(directory, entry.name))
          .sort((left, right) => left.localeCompare(right));
        for (const path of files) {
          yield ok({ path });
        }
      },
      "source",
      false,
    );
  }

  static fromBytes(bytes: Uint8Array | ArrayBuffer): PdfFileLoader<LoaderResult<PdfSource>> {
    return PdfFileLoader.fromBytesMany([bytes]);
  }

  static fromBytesMany(
    bytes: Array<Uint8Array | ArrayBuffer>,
  ): PdfFileLoader<LoaderResult<PdfSource>> {
    return new PdfFileLoader(
      async function* () {
        for (const value of bytes) {
          yield ok({ path: "<memory>", bytes: toUint8Array(value) });
        }
      },
      "source",
      false,
    );
  }

  read(): PdfFileLoader<LoaderResult<string>> {
    return new PdfFileLoader(this.source, "read", this.skipErrors);
  }

  readWithPath(): PdfFileLoader<LoaderResult<PdfReadWithPath>> {
    return new PdfFileLoader(this.source, "readWithPath", this.skipErrors);
  }

  byPage(
    this: PdfFileLoader<LoaderResult<PdfReadWithPath>>,
  ): PdfFileLoader<LoaderResult<PdfPageWithPath>>;
  byPage(this: PdfFileLoader<PdfReadWithPath>): PdfFileLoader<PdfPageWithPath>;
  byPage(): PdfFileLoader<LoaderResult<PdfPage>>;
  byPage(): PdfFileLoader<LoaderResult<PdfPage> | LoaderResult<PdfPageWithPath> | PdfPageWithPath> {
    const mode = this.mode === "readWithPath" ? "byPageWithPath" : "byPage";
    return new PdfFileLoader(this.source, mode, this.skipErrors);
  }

  ignoreErrors(): PdfFileLoader<UnwrapLoaderResult<T>> {
    return new PdfFileLoader(this.source, this.mode, true) as PdfFileLoader<UnwrapLoaderResult<T>>;
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    for await (const item of this.source()) {
      const results = await mapPdfResult(item, this.mode);
      for (const result of results) {
        if (!result.ok && this.skipErrors) {
          continue;
        }
        yield (this.skipErrors && result.ok ? result.value : result) as T;
      }
    }
  }
}

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

type LoaderValue<T> = T extends { ok: true; value: infer Value } ? Value : never;
type UnwrapLoaderResult<T> = [LoaderValue<T>] extends [never] ? T : LoaderValue<T>;

function ok<T>(value: T): LoaderResult<T> {
  return { ok: true, value };
}

function err(error: unknown): LoaderResult<never> {
  return { ok: false, error };
}

async function sortedGlob(pattern: string): Promise<string[]> {
  return (await glob(pattern, { absolute: isAbsolute(pattern), onlyFiles: true })).sort(
    (left, right) => left.localeCompare(right),
  );
}

async function mapFileResult(
  item: LoaderResult<FileSource>,
  mode: FileMode,
): Promise<LoaderResult<FileSource | string | FileReadWithPath>> {
  if (!item.ok) {
    return item;
  }
  if (mode === "source") {
    return item;
  }
  try {
    const text = await readFileSource(item.value);
    return mode === "read" ? ok(text) : ok({ path: item.value.path, text });
  } catch (error) {
    return err(error);
  }
}

async function mapPdfResult(
  item: LoaderResult<PdfSource>,
  mode: PdfMode,
): Promise<Array<LoaderResult<PdfSource | string | PdfReadWithPath | PdfPage | PdfPageWithPath>>> {
  if (!item.ok) {
    return [item];
  }
  if (mode === "source") {
    return [item];
  }
  try {
    const pages = await readPdfPages(item.value);
    if (mode === "read") {
      return [ok(pages.map((page) => page.text).join(""))];
    }
    if (mode === "readWithPath") {
      return [ok({ path: item.value.path, text: pages.map((page) => page.text).join("") })];
    }
    if (mode === "byPageWithPath") {
      return pages.map((page) => ok({ path: item.value.path, ...page }));
    }
    return pages.map(ok);
  } catch (error) {
    return [err(error)];
  }
}

async function readFileSource(source: FileSource): Promise<string> {
  if ("bytes" in source) {
    return new TextDecoder().decode(source.bytes);
  }
  return readFile(source.path, "utf8");
}

async function readPdfPages(source: PdfSource): Promise<PdfPage[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const bytes = "bytes" in source ? source.bytes : toUint8Array(await readFile(source.path));
  const document = await pdfjs.getDocument({ data: bytes }).promise;
  const pages: PdfPage[] = [];
  try {
    for (let index = 1; index <= document.numPages; index += 1) {
      const page = await document.getPage(index);
      const content = await page.getTextContent();
      const text = content.items
        .flatMap((item) =>
          typeof item === "object" && item !== null && "str" in item ? [String(item.str)] : [],
        )
        .join("\n");
      pages.push({ pageNumber: index - 1, text: text.length > 0 ? `${text}\n` : "" });
    }
  } finally {
    await document.destroy();
  }
  return pages;
}

function toUint8Array(bytes: Uint8Array | ArrayBuffer): Uint8Array {
  if (bytes instanceof Uint8Array) {
    return new Uint8Array(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    );
  }
  return new Uint8Array(bytes);
}
