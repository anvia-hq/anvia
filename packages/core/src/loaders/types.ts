export type LoaderResult<T> = { ok: true; value: T } | { ok: false; error: unknown };
export type LoaderValue<T> = T extends { ok: true; value: infer Value } ? Value : never;
export type UnwrapLoaderResult<T> = [LoaderValue<T>] extends [never] ? T : LoaderValue<T>;

export type FileSource = { path: string } | { path: "<memory>"; bytes: Uint8Array };
export type FileReadWithPath = { path: string; text: string };
export type FileMode = "source" | "read" | "readWithPath";

export type PdfSource = { path: string } | { path: "<memory>"; bytes: Uint8Array };
export type PdfReadWithPath = { path: string; text: string };
export type PdfPage = { pageNumber: number; text: string };
export type PdfPageWithPath = { path: string; pageNumber: number; text: string };
