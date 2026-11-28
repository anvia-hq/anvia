import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  type AnyTool,
  createTool,
  createToolkit,
  type Toolkit,
  type ToolkitOptions,
} from "@anvia/core/tool";
import { z } from "zod";
import { truncateText } from "../../internal/truncate";
import {
  resolveCanonicalRoot,
  resolveSafeDeleteTarget,
  resolveSafePath,
  toRelativePosixPath,
} from "./path-safety";

export type FilesystemReadToolName = "read_file" | "list_files" | "grep";
export type FilesystemWriteToolName = "write_file" | "edit_file" | "delete_file";
export type FilesystemToolName = FilesystemReadToolName | FilesystemWriteToolName;

export type FilesystemOptions = ToolkitOptions<FilesystemToolName> & {
  /** Directory all file operations are sandboxed to. */
  rootDir: string;
  /** When true, only read_file, list_files, and grep are registered. Default false. */
  readOnly?: boolean | undefined;
  /** Maximum file size in bytes for read/write/grep operations. Default 512_000 (512 KB). */
  maxFileBytes?: number | undefined;
  /** Maximum entries returned by list_files. Default 200. */
  maxEntries?: number | undefined;
  /** Maximum matches returned by grep. Default 100. */
  maxMatches?: number | undefined;
  /** Maximum files scanned by grep before truncating. Default 5_000. */
  maxScannedFiles?: number | undefined;
  /** Maximum characters per matched line in grep output. Default 500. */
  maxMatchLineChars?: number | undefined;
};

const DEFAULT_INSTRUCTIONS =
  "Use filesystem tools to inspect and edit files inside the workspace root. Read files before editing them, and keep paths relative to the workspace root.";

const READONLY_INSTRUCTIONS =
  "Use filesystem tools to inspect files inside the workspace root. Keep paths relative to the workspace root.";

export function filesystem(options: FilesystemOptions): Toolkit {
  const maxFileBytes = options.maxFileBytes ?? 512_000;
  const maxEntries = options.maxEntries ?? 200;
  const maxMatches = options.maxMatches ?? 100;
  const maxScannedFiles = options.maxScannedFiles ?? 5_000;
  const maxMatchLineChars = options.maxMatchLineChars ?? 500;
  const readOnly = options.readOnly ?? false;

  if (options.rootDir.trim().length === 0) {
    throw new TypeError("filesystem rootDir must not be empty.");
  }

  if (!Number.isSafeInteger(maxFileBytes) || maxFileBytes <= 0) {
    throw new RangeError("filesystem maxFileBytes must be a positive safe integer.");
  }

  if (!Number.isSafeInteger(maxEntries) || maxEntries <= 0) {
    throw new RangeError("filesystem maxEntries must be a positive safe integer.");
  }

  if (!Number.isSafeInteger(maxMatches) || maxMatches <= 0) {
    throw new RangeError("filesystem maxMatches must be a positive safe integer.");
  }

  if (!Number.isSafeInteger(maxScannedFiles) || maxScannedFiles <= 0) {
    throw new RangeError("filesystem maxScannedFiles must be a positive safe integer.");
  }

  if (!Number.isSafeInteger(maxMatchLineChars) || maxMatchLineChars <= 0) {
    throw new RangeError("filesystem maxMatchLineChars must be a positive safe integer.");
  }

  let rootPromise: Promise<string> | undefined;
  const getRoot = (): Promise<string> => {
    if (rootPromise === undefined) {
      const pending = resolveCanonicalRoot(options.rootDir).catch((error) => {
        if (rootPromise === pending) rootPromise = undefined;

        throw error;
      });
      rootPromise = pending;
    }

    return rootPromise;
  };

  const readFileTool = createTool({
    name: "read_file",
    description: "Read a UTF-8 text file inside the workspace, with optional 1-based line paging.",
    inputSchema: z.object({
      path: z.string().min(1).describe("Workspace-relative path to the file."),
      offset: z.number().int().min(1).optional().describe("1-based starting line number."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(2_000)
        .optional()
        .describe("Maximum number of lines to return."),
    }),
    handler: async (args) => {
      const root = await getRoot();
      const target = await resolveSafePath(root, args.path);
      const info = await stat(target);

      if (!info.isFile()) {
        throw new Error(`"${args.path}" is not a file.`);
      }

      if (info.size > maxFileBytes) {
        throw new Error(
          `File "${args.path}" (${info.size} bytes) exceeds maxFileBytes (${maxFileBytes}).`,
        );
      }

      const raw = await readFile(target, "utf8");
      const allLines = raw.split(/\r?\n/);
      const startLine = args.offset ?? 1;
      const startIndex = startLine - 1;
      const endIndex =
        args.limit === undefined
          ? allLines.length
          : Math.min(allLines.length, startIndex + args.limit);
      const slice = allLines.slice(startIndex, endIndex);

      return {
        path: toRelativePosixPath(root, target),
        totalLines: allLines.length,
        startLine,
        endLine: slice.length === 0 ? startLine : startIndex + slice.length,
        truncated: endIndex < allLines.length,
        content: slice.join("\n"),
      };
    },
  });

  const listFilesTool = createTool({
    name: "list_files",
    description: "List files and directories inside the workspace.",
    inputSchema: z.object({
      path: z.string().optional().describe('Workspace-relative directory path (defaults to ".").'),
      recursive: z
        .boolean()
        .optional()
        .describe("Whether to walk subdirectories recursively. Default false."),
    }),
    handler: async (args, context) => {
      throwIfAborted(context.abortSignal);
      const root = await getRoot();
      const dir = await resolveSafePath(root, args.path ?? ".");
      const info = await stat(dir);

      if (!info.isDirectory()) {
        throw new Error(`"${args.path ?? "."}" is not a directory.`);
      }

      const entries: Array<{ path: string; type: "file" | "directory" | "other" }> = [];
      let truncated = false;

      const walk = async (currentDir: string): Promise<void> => {
        throwIfAborted(context.abortSignal);
        const items = await readdir(currentDir, { withFileTypes: true }).catch((error) => {
          if (isSkippableFsError(error)) return [];

          throw error;
        });
        items.sort((a, b) => a.name.localeCompare(b.name));

        for (const item of items) {
          throwIfAborted(context.abortSignal);

          if (entries.length >= maxEntries) {
            truncated = true;
            return;
          }

          const fullPath = path.join(currentDir, item.name);
          let type: "file" | "directory" | "other" = "other";

          if (item.isDirectory()) {
            type = "directory";
          } else if (item.isFile()) {
            type = "file";
          }

          entries.push({ path: toRelativePosixPath(root, fullPath), type });

          if (args.recursive && item.isDirectory()) {
            await walk(fullPath);
          }
        }
      };

      await walk(dir);

      return {
        path: toRelativePosixPath(root, dir),
        entries,
        truncated,
      };
    },
  });

  const grepTool = createTool({
    name: "grep",
    description: "Search for a text or regular expression pattern across files in the workspace.",
    inputSchema: z.object({
      pattern: z.string().min(1).describe("Substring or regex pattern to search for."),
      path: z
        .string()
        .optional()
        .describe('Workspace-relative file or directory to search (defaults to ".").'),
      regex: z
        .boolean()
        .optional()
        .describe(
          "Treat pattern as a regular expression instead of a literal string. Default false.",
        ),
      caseSensitive: z.boolean().optional().describe("Case-sensitive match. Default true."),
    }),
    handler: async (args, context) => {
      throwIfAborted(context.abortSignal);
      const root = await getRoot();
      const target = await resolveSafePath(root, args.path ?? ".");
      const targetStat = await stat(target);
      const caseSensitive = args.caseSensitive ?? true;
      const matcher = buildLineMatcher(args.pattern, args.regex ?? false, caseSensitive);

      const matches: Array<{ path: string; line: number; text: string }> = [];
      let scannedFiles = 0;
      let truncated = false;

      const scanFile = async (filePath: string): Promise<void> => {
        throwIfAborted(context.abortSignal);

        if (matches.length >= maxMatches || scannedFiles >= maxScannedFiles) {
          truncated = true;
          return;
        }

        const fileInfo = await stat(filePath).catch((error) => {
          if (isSkippableFsError(error)) return undefined;

          throw error;
        });

        if (fileInfo === undefined || !fileInfo.isFile() || fileInfo.size > maxFileBytes) return;

        scannedFiles += 1;

        const buffer = await readFile(filePath).catch((error) => {
          if (isSkippableFsError(error)) return undefined;

          throw error;
        });

        if (buffer === undefined || buffer.includes(0)) return;

        const lines = buffer.toString("utf8").split(/\r?\n/);
        const rel = toRelativePosixPath(root, filePath);

        for (let i = 0; i < lines.length; i++) {
          const lineText = lines[i]!;

          if (matcher(lineText)) {
            if (matches.length >= maxMatches) {
              truncated = true;
              return;
            }

            const clipped = truncateText(lineText, maxMatchLineChars, "...").text;
            matches.push({ path: rel, line: i + 1, text: clipped });
          }
        }
      };

      const walkDir = async (dirPath: string): Promise<void> => {
        throwIfAborted(context.abortSignal);
        const items = await readdir(dirPath, { withFileTypes: true }).catch((error) => {
          if (isSkippableFsError(error)) return [];

          throw error;
        });
        items.sort((a, b) => a.name.localeCompare(b.name));

        for (const item of items) {
          throwIfAborted(context.abortSignal);

          if (matches.length >= maxMatches || scannedFiles >= maxScannedFiles) {
            truncated = true;
            return;
          }

          if (item.name === ".git" || item.name === "node_modules") continue;

          const childPath = path.join(dirPath, item.name);

          if (item.isDirectory()) {
            await walkDir(childPath);
          } else if (item.isFile()) {
            await scanFile(childPath);
          }
        }
      };

      if (targetStat.isFile()) {
        await scanFile(target);
      } else if (targetStat.isDirectory()) {
        await walkDir(target);
      }

      return { matches, truncated };
    },
  });

  const tools: AnyTool[] = [readFileTool, listFilesTool, grepTool];

  if (!readOnly) {
    const writeFileTool = createTool({
      name: "write_file",
      description: "Create or overwrite a UTF-8 text file inside the workspace.",
      inputSchema: z.object({
        path: z.string().min(1).describe("Workspace-relative path to write."),
        content: z.string().describe("Full UTF-8 file contents to write."),
      }),
      handler: async (args) => {
        const bytes = Buffer.byteLength(args.content, "utf8");

        if (bytes > maxFileBytes) {
          throw new Error(`Content (${bytes} bytes) exceeds maxFileBytes (${maxFileBytes}).`);
        }

        const root = await getRoot();
        const target = await resolveSafePath(root, args.path, { allowMissing: true });
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, args.content, "utf8");

        return {
          path: toRelativePosixPath(root, target),
          bytesWritten: bytes,
        };
      },
    });

    const editFileTool = createTool({
      name: "edit_file",
      description: "Replace an exact text block in an existing UTF-8 file inside the workspace.",
      inputSchema: z.object({
        path: z.string().min(1).describe("Workspace-relative path to edit."),
        oldText: z.string().min(1).describe("Exact text to search for."),
        newText: z.string().describe("Replacement text."),
        replaceAll: z
          .boolean()
          .optional()
          .describe("Replace all occurrences instead of requiring a unique match. Default false."),
      }),
      handler: async (args) => {
        const root = await getRoot();
        const target = await resolveSafePath(root, args.path);
        const info = await stat(target);

        if (!info.isFile()) {
          throw new Error(`"${args.path}" is not a file.`);
        }

        if (info.size > maxFileBytes) {
          throw new Error(
            `File "${args.path}" (${info.size} bytes) exceeds maxFileBytes (${maxFileBytes}).`,
          );
        }

        const existing = await readFile(target, "utf8");
        const occurrences = countOccurrences(existing, args.oldText);

        if (occurrences === 0) {
          throw new Error(`oldText was not found in "${args.path}".`);
        }

        if (occurrences > 1 && !args.replaceAll) {
          throw new Error(
            `oldText matched ${occurrences} times in "${args.path}". Provide more context or set replaceAll: true.`,
          );
        }

        const updated = args.replaceAll
          ? existing.split(args.oldText).join(args.newText)
          : existing.replace(args.oldText, () => args.newText);
        const bytes = Buffer.byteLength(updated, "utf8");

        if (bytes > maxFileBytes) {
          throw new Error(`Edited file (${bytes} bytes) exceeds maxFileBytes (${maxFileBytes}).`);
        }

        await writeFile(target, updated, "utf8");
        return {
          path: toRelativePosixPath(root, target),
          replacements: args.replaceAll ? occurrences : 1,
        };
      },
    });

    const deleteFileTool = createTool({
      name: "delete_file",
      description: "Delete a file inside the workspace.",
      inputSchema: z.object({
        path: z.string().min(1).describe("Workspace-relative path to the file to delete."),
      }),
      requiresApproval: { reason: "Deleting a workspace file requires approval." },
      handler: async (args) => {
        const root = await getRoot();
        const target = await resolveSafeDeleteTarget(root, args.path);
        await rm(target);
        return {
          path: toRelativePosixPath(root, target),
          deleted: true,
        };
      },
    });

    tools.push(writeFileTool, editFileTool, deleteFileTool);
  }

  return createToolkit<FilesystemToolName>(
    {
      name: "filesystem",
      tools,
      instructions: readOnly ? READONLY_INSTRUCTIONS : DEFAULT_INSTRUCTIONS,
    },
    options,
  );
}

function buildLineMatcher(
  pattern: string,
  useRegex: boolean,
  caseSensitive: boolean,
): (line: string) => boolean {
  if (useRegex) {
    let regex: RegExp;
    try {
      regex = new RegExp(pattern, caseSensitive ? "" : "i");
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid grep regular expression "${pattern}": ${detail}`);
    }

    return (line) => regex.test(line);
  }

  if (caseSensitive) {
    return (line) => line.includes(pattern);
  }

  const needle = pattern.toLowerCase();
  return (line) => line.toLowerCase().includes(needle);
}

function countOccurrences(text: string, needle: string): number {
  let count = 0;
  let index = 0;
  while ((index = text.indexOf(needle, index)) !== -1) {
    count++;
    index += needle.length;
  }
  return count;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new Error("Filesystem operation aborted.");
  }
}

function isSkippableFsError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;

  const code = (error as { code?: unknown }).code;
  return code === "ENOENT" || code === "EACCES" || code === "EPERM" || code === "ENOTDIR";
}
