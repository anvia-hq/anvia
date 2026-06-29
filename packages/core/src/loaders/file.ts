import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { err, ok, sortedGlob, toUint8Array } from "./shared";
import type {
  FileMode,
  FileReadWithPath,
  FileSource,
  LoaderResult,
  UnwrapLoaderResult,
} from "./types";

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

async function readFileSource(source: FileSource): Promise<string> {
  if ("bytes" in source) {
    return new TextDecoder().decode(source.bytes);
  }
  return readFile(source.path, "utf8");
}
