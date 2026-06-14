import { isAbsolute } from "node:path";
import { glob } from "tinyglobby";
import type { LoaderResult } from "./types";

export function ok<T>(value: T): LoaderResult<T> {
  return { ok: true, value };
}

export function err(error: unknown): LoaderResult<never> {
  return { ok: false, error };
}

export async function sortedGlob(pattern: string): Promise<string[]> {
  return (await glob(pattern, { absolute: isAbsolute(pattern), onlyFiles: true })).sort(
    (left, right) => left.localeCompare(right),
  );
}

export function toUint8Array(bytes: Uint8Array | ArrayBuffer): Uint8Array {
  if (bytes instanceof Uint8Array) {
    return new Uint8Array(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    );
  }
  return new Uint8Array(bytes);
}
