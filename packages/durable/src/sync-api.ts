/** The synchronous shape of an async store API, for backends that run on a synchronous driver. */
export type SyncApi<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => Promise<infer R> ? (...args: A) => R : T[K];
};

/** Wraps each method so it returns a promise; a throw becomes a rejection. */
export function promisify<T extends object>(api: SyncApi<T>): T {
  const wrapped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(api)) {
    wrapped[key] =
      typeof value === "function"
        ? async (...args: unknown[]) => (value as (...a: unknown[]) => unknown)(...args)
        : value;
  }
  return wrapped as T;
}
