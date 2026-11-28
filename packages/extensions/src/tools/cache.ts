import {
  type AnyTool,
  createToolkit,
  isToolkit,
  type ToolCallContext,
  type Toolkit,
  ToolOutput,
} from "@anvia/core/tool";
import { copyOwnSymbols } from "../internal/tool-wrapper";

export type ToolCacheOptions = {
  /** Time-to-live for cached results in milliseconds. */
  ttlMs: number;
  /** Maximum number of cached entries (LRU eviction). Default 100. */
  maxEntries?: number | undefined;
  /** Optional allowlist of tool names to cache when wrapping a Toolkit. */
  tools?: readonly string[] | undefined;
  /** Optional custom clock for deterministic testing. */
  now?: (() => number) | undefined;
};

type CacheEntry = {
  value: unknown;
  expiresAt: number;
};

const RICH_TOOL_OUTPUT_SYMBOL = Symbol.for("anvia.tool-output.content");

export function withToolCache<T extends AnyTool | Toolkit>(
  target: T,
  options: ToolCacheOptions,
): T {
  if (!Number.isFinite(options.ttlMs) || options.ttlMs <= 0) {
    throw new RangeError("withToolCache ttlMs must be a positive finite number.");
  }

  const maxEntries = options.maxEntries ?? 100;

  if (!Number.isSafeInteger(maxEntries) || maxEntries <= 0) {
    throw new RangeError("withToolCache maxEntries must be a positive safe integer.");
  }

  const now = options.now ?? Date.now;
  const cache = new Map<string, CacheEntry>();

  const wrapSingleTool = (tool: AnyTool): AnyTool => {
    const wrapped: {
      name: string;
      requiresApproval?: unknown;
      definition: AnyTool["definition"];
      parseInput?: NonNullable<AnyTool["parseInput"]>;
      call(args: unknown, context?: ToolCallContext): Promise<unknown>;
    } = {
      name: tool.name,
      definition: (prompt) => tool.definition(prompt),
      async call(args: unknown, context?: ToolCallContext): Promise<unknown> {
        const key = `${tool.name}:${canonicalizeValue(args, new WeakSet())}`;
        const currentTime = now();
        const existing = cache.get(key);

        if (existing !== undefined) {
          if (existing.expiresAt > currentTime) {
            cache.delete(key);
            cache.set(key, existing);
            return cloneCachedValue(existing.value);
          }

          cache.delete(key);
        }

        const result = await tool.call(args, context);

        if (cache.has(key)) {
          cache.delete(key);
        } else if (cache.size >= maxEntries) {
          const oldestKey = cache.keys().next().value;

          if (oldestKey !== undefined) cache.delete(oldestKey);
        }

        cache.set(key, {
          value: cloneCachedValue(result),
          expiresAt: now() + options.ttlMs,
        });

        return result;
      },
    };

    if (tool.requiresApproval !== undefined) {
      wrapped.requiresApproval = tool.requiresApproval;
    }

    if (tool.parseInput !== undefined) {
      const parseInput = tool.parseInput.bind(tool);
      wrapped.parseInput = (args) => parseInput(args);
    }

    copyOwnSymbols(tool, wrapped);

    return wrapped;
  };

  if (isToolkit(target)) {
    const knownNames = new Set(target.tools.map((tool) => tool.name));
    let filter: Set<string> | undefined;

    if (options.tools !== undefined) {
      for (const name of options.tools) {
        if (!knownNames.has(name)) {
          throw new TypeError(
            `Unknown tool "${name}" in withToolCache tools option for toolkit "${target.name}".`,
          );
        }
      }

      filter = new Set(options.tools);
    }

    const wrappedTools = target.tools.map((tool) =>
      filter === undefined || filter.has(tool.name) ? wrapSingleTool(tool) : tool,
    );
    return createToolkit({
      name: target.name,
      tools: wrappedTools,
      instructions: target.instructions,
    }) as T;
  }

  return wrapSingleTool(target) as T;
}

function canonicalizeValue(value: unknown, seen: WeakSet<object>): string {
  if (typeof value === "bigint") {
    return `bigint:${value.toString()}`;
  }

  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "undefined";
  }

  if (seen.has(value)) {
    return '"[Circular]"';
  }

  if (value instanceof Date) {
    return `date:${Number.isNaN(value.getTime()) ? "NaN" : value.toISOString()}`;
  }

  if (value instanceof URL) {
    return `url:${value.toString()}`;
  }

  if (value instanceof RegExp) {
    return `regexp:${value.toString()}`;
  }

  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((item) => canonicalizeValue(item, seen)).join(",")}]`;
    }

    if (value instanceof Set) {
      const items = [...value].map((item) => canonicalizeValue(item, seen)).sort();
      return `set:[${items.join(",")}]`;
    }

    if (value instanceof Map) {
      const entries = [...value.entries()]
        .map(([k, v]) => `${canonicalizeValue(k, seen)}=>${canonicalizeValue(v, seen)}`)
        .sort();
      return `map:{${entries.join(",")}}`;
    }

    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalizeValue(v, seen)}`).join(",")}}`;
  } finally {
    seen.delete(value);
  }
}

function cloneCachedValue<T>(value: T): T {
  if (isRichToolOutput(value)) {
    const clonedParts = clonePlain(value.content);
    return ToolOutput.content(clonedParts) as unknown as T;
  }

  return clonePlain(value);
}

function clonePlain<T>(value: T): T {
  try {
    return globalThis.structuredClone(value);
  } catch {
    return value;
  }
}

function isRichToolOutput(
  value: unknown,
): value is { content: Parameters<typeof ToolOutput.content>[0] } {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.getOwnPropertyDescriptor(value, RICH_TOOL_OUTPUT_SYMBOL)?.value === true &&
    Array.isArray((value as { content?: unknown }).content)
  );
}
