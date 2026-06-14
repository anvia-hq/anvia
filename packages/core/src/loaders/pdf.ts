import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { err, ok, sortedGlob, toUint8Array } from "./shared";
import type { LoaderResult, PdfPage, PdfPageWithPath, PdfReadWithPath, PdfSource } from "./types";

type PdfMode = "source" | "read" | "readWithPath" | "byPage" | "byPageWithPath";
type LoaderValue<T> = T extends { ok: true; value: infer Value } ? Value : never;
type UnwrapLoaderResult<T> = [LoaderValue<T>] extends [never] ? T : LoaderValue<T>;

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

async function readPdfPages(source: PdfSource): Promise<PdfPage[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const bytes = "bytes" in source ? source.bytes : toUint8Array(await readFile(source.path));
  const loadingTask = pdfjs.getDocument({ data: bytes });
  const document = await loadingTask.promise;
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
    await loadingTask.destroy();
  }
  return pages;
}
