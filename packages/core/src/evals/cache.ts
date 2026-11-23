import type { EvalCase, EvalTarget, EvalTargetCache, EvalTargetCacheEntry } from "./types";

/** Builds a deterministic cache key from a case id, serialized input, and trial index. */
export function defaultEvalCacheKey<Input, Expected>(
  testCase: EvalCase<Input, Expected>,
  trial = 1,
): string {
  let serializedInput: string;
  try {
    serializedInput = JSON.stringify(testCase.input) ?? String(testCase.input);
  } catch {
    serializedInput = String(testCase.input);
  }

  return `${testCase.id}::trial=${trial}::${serializedInput}`;
}

/** Creates an in-memory target output cache for reusing target outputs across eval runs. */
export function createMemoryEvalCache<
  Input = unknown,
  Output = unknown,
  Expected = unknown,
>(options?: {
  keyFor?(testCase: EvalCase<Input, Expected>, trial: number): string;
}): EvalTargetCache<Input, Output, Expected> & {
  clear(): void;
  readonly size: number;
} {
  const store = new Map<string, EvalTargetCacheEntry<Output>>();
  const cache: EvalTargetCache<Input, Output, Expected> & {
    clear(): void;
    readonly size: number;
  } = {
    get(key) {
      return store.get(key);
    },
    set(key, entry) {
      store.set(key, entry);
    },
    clear() {
      store.clear();
    },
    get size() {
      return store.size;
    },
  };

  if (options?.keyFor !== undefined) {
    cache.keyFor = options.keyFor;
  }

  return cache;
}

/** Creates a JSON file-backed target output cache so metric/judge iterations avoid re-running targets. */
export function createFileEvalCache<Input = unknown, Output = unknown, Expected = unknown>(
  filePath: string,
  options?: {
    keyFor?(testCase: EvalCase<Input, Expected>, trial: number): string;
  },
): EvalTargetCache<Input, Output, Expected> {
  let loaded: Record<string, EvalTargetCacheEntry<Output>> | undefined;
  let loadPromise: Promise<Record<string, EvalTargetCacheEntry<Output>>> | undefined;
  let writeChain = Promise.resolve();

  async function ensureLoaded(): Promise<Record<string, EvalTargetCacheEntry<Output>>> {
    if (loaded !== undefined) return loaded;

    if (loadPromise === undefined) {
      loadPromise = (async () => {
        const fs = await import("node:fs/promises");
        try {
          const content = await fs.readFile(filePath, "utf8");
          const parsed: unknown = JSON.parse(content);

          if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
            loaded = parsed as Record<string, EvalTargetCacheEntry<Output>>;
            return loaded;
          }
        } catch (error) {
          if (
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            error.code === "ENOENT"
          ) {
            loaded = {};
            return loaded;
          }

          throw error;
        }
        loaded = {};
        return loaded;
      })();
    }

    return loadPromise;
  }

  const cache: EvalTargetCache<Input, Output, Expected> = {
    async get(key) {
      const store = await ensureLoaded();
      return Object.hasOwn(store, key) ? store[key] : undefined;
    },
    async set(key, entry) {
      const store = await ensureLoaded();
      store[key] = entry;
      const snapshot = JSON.stringify(store, null, 2);
      writeChain = writeChain.then(async () => {
        const [fs, path] = await Promise.all([import("node:fs/promises"), import("node:path")]);
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, `${snapshot}\n`, "utf8");
      });
      await writeChain;
    },
  };

  if (options?.keyFor !== undefined) {
    cache.keyFor = options.keyFor;
  }

  return cache;
}

/** Wraps an EvalTarget with a cache so repeated calls with matching case keys return cached outputs. */
export function cachedEvalTarget<Input, Output, Expected = unknown>(
  target: EvalTarget<Input, Output, Expected>,
  cache: EvalTargetCache<Input, Output, Expected>,
): EvalTarget<Input, Output, Expected> {
  return async (input, testCase, context) => {
    const key = cache.keyFor ? cache.keyFor(testCase, 1) : defaultEvalCacheKey(testCase, 1);
    const hit = await cache.get(key, testCase);

    if (hit !== undefined) {
      return hit.output;
    }

    const startedAt = performance.now();
    const output = await target(input, testCase, context);
    await cache.set(
      key,
      {
        output,
        targetDurationMs: performance.now() - startedAt,
        cachedAt: new Date().toISOString(),
      },
      testCase,
    );
    return output;
  };
}
