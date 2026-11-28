import { createTool, createToolkit, type Toolkit, type ToolkitOptions } from "@anvia/core/tool";
import { z } from "zod";

export type ScratchpadEntry = {
  key: string;
  value: string;
  updatedAt: string;
};

export interface ScratchpadStore {
  get(key: string): ScratchpadEntry | undefined | Promise<ScratchpadEntry | undefined>;
  set(key: string, value: string): ScratchpadEntry | Promise<ScratchpadEntry>;
  delete(key: string): boolean | Promise<boolean>;
  list(prefix?: string): readonly ScratchpadEntry[] | Promise<readonly ScratchpadEntry[]>;
}

export class InMemoryScratchpadStore implements ScratchpadStore {
  private readonly entries = new Map<string, ScratchpadEntry>();
  private readonly maxEntries: number;
  private readonly maxValueChars: number;
  private readonly now: () => string;

  constructor(
    options: {
      maxEntries?: number | undefined;
      maxValueChars?: number | undefined;
      initial?: Record<string, string> | undefined;
      now?: (() => string) | undefined;
    } = {},
  ) {
    const maxEntries = options.maxEntries ?? 100;
    const maxValueChars = options.maxValueChars ?? 16_000;

    if (!Number.isSafeInteger(maxEntries) || maxEntries <= 0) {
      throw new RangeError("InMemoryScratchpadStore maxEntries must be a positive safe integer.");
    }

    if (!Number.isSafeInteger(maxValueChars) || maxValueChars <= 0) {
      throw new RangeError(
        "InMemoryScratchpadStore maxValueChars must be a positive safe integer.",
      );
    }

    this.maxEntries = maxEntries;
    this.maxValueChars = maxValueChars;
    this.now = options.now ?? (() => new Date().toISOString());

    if (options.initial !== undefined) {
      for (const [key, value] of Object.entries(options.initial)) {
        this.set(key, value);
      }
    }
  }

  get(key: string): ScratchpadEntry | undefined {
    const existing = this.entries.get(key);
    return existing === undefined ? undefined : { ...existing };
  }

  set(key: string, value: string): ScratchpadEntry {
    const normalizedKey = key.trim();

    if (normalizedKey.length === 0) {
      throw new TypeError("Scratchpad key must not be empty.");
    }

    if (value.length > this.maxValueChars) {
      throw new RangeError(
        `Scratchpad value for "${normalizedKey}" exceeds maxValueChars (${this.maxValueChars}).`,
      );
    }

    if (!this.entries.has(normalizedKey) && this.entries.size >= this.maxEntries) {
      throw new RangeError(`Scratchpad store reached maxEntries limit (${this.maxEntries}).`);
    }

    const entry: ScratchpadEntry = {
      key: normalizedKey,
      value,
      updatedAt: this.now(),
    };
    this.entries.set(normalizedKey, entry);
    return { ...entry };
  }

  delete(key: string): boolean {
    return this.entries.delete(key);
  }

  list(prefix?: string): readonly ScratchpadEntry[] {
    const result: ScratchpadEntry[] = [];

    for (const entry of this.entries.values()) {
      if (prefix === undefined || entry.key.startsWith(prefix)) {
        result.push({ ...entry });
      }
    }

    return result;
  }
}

export type ScratchpadToolName = "note_get" | "note_set" | "note_delete" | "note_list";

export type ScratchpadOptions = ToolkitOptions<ScratchpadToolName> & {
  /** Custom backing store. Defaults to an `InMemoryScratchpadStore`. */
  store?: ScratchpadStore | undefined;
  /** Maximum entries when using the default in-memory store. Default 100. */
  maxEntries?: number | undefined;
  /** Maximum characters per note value when using the default store. Default 16_000. */
  maxValueChars?: number | undefined;
};

const DEFAULT_INSTRUCTIONS =
  "Use scratchpad tools (note_set, note_get, note_list, note_delete) to store and retrieve structured working notes across steps.";

export function scratchpad(options: ScratchpadOptions = {}): Toolkit {
  const store =
    options.store ??
    new InMemoryScratchpadStore({
      maxEntries: options.maxEntries,
      maxValueChars: options.maxValueChars,
    });

  const getTool = createTool({
    name: "note_get",
    description: "Retrieve a note from the scratchpad by key.",
    inputSchema: z.object({
      key: z.string().min(1).describe("Note key to look up."),
    }),
    async handler(args) {
      const key = assertNonEmptyKey(args.key);
      const entry = await store.get(key);

      if (entry === undefined) {
        return { found: false, key };
      }

      return {
        found: true,
        key: entry.key,
        value: entry.value,
        updatedAt: entry.updatedAt,
      };
    },
  });

  const setTool = createTool({
    name: "note_set",
    description: "Store or overwrite a working note in the scratchpad.",
    inputSchema: z.object({
      key: z.string().min(1).max(128).describe("Short unique key for the note."),
      value: z.string().describe("Note content."),
    }),
    async handler(args) {
      const key = assertNonEmptyKey(args.key);
      const entry = await store.set(key, args.value);
      return {
        saved: true,
        key: entry.key,
        length: entry.value.length,
        updatedAt: entry.updatedAt,
      };
    },
  });

  const deleteTool = createTool({
    name: "note_delete",
    description: "Delete a note from the scratchpad by key.",
    inputSchema: z.object({
      key: z.string().min(1).describe("Note key to remove."),
    }),
    async handler(args) {
      const key = assertNonEmptyKey(args.key);
      const deleted = await store.delete(key);
      return { deleted, key };
    },
  });

  const listTool = createTool({
    name: "note_list",
    description: "List stored note keys (optionally filtered by prefix).",
    inputSchema: z.object({
      prefix: z.string().optional().describe("Optional key prefix filter."),
    }),
    async handler(args) {
      const entries = await store.list(args.prefix);
      return {
        count: entries.length,
        keys: entries.map((entry) => ({
          key: entry.key,
          length: entry.value.length,
          updatedAt: entry.updatedAt,
        })),
      };
    },
  });

  const toolkitOptions: ToolkitOptions<ScratchpadToolName> = {
    instructions: options.instructions ?? DEFAULT_INSTRUCTIONS,
  };

  if (options.include !== undefined) toolkitOptions.include = options.include;

  if (options.exclude !== undefined) toolkitOptions.exclude = options.exclude;

  if (options.prefix !== undefined) toolkitOptions.prefix = options.prefix;

  if (options.requiresApproval !== undefined) {
    toolkitOptions.requiresApproval = options.requiresApproval;
  }

  if (options.timeoutMs !== undefined) toolkitOptions.timeoutMs = options.timeoutMs;

  return createToolkit(
    {
      name: "scratchpad",
      tools: [getTool, setTool, deleteTool, listTool],
    },
    toolkitOptions,
  );
}

function assertNonEmptyKey(raw: string): string {
  const key = raw.trim();

  if (key.length === 0) {
    throw new Error("Note key must not be empty.");
  }

  return key;
}
