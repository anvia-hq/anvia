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
  isPathWithinRoot,
  resolveCanonicalRoot,
  resolveSafePath,
  toRelativePosixPath,
} from "../fs/path-safety";
import { executeChildProcess } from "../../internal/child-process";

export type GitReadToolName = "git_status" | "git_diff" | "git_log" | "git_show" | "git_branch";
export type GitWriteToolName = "git_stage" | "git_commit";
export type GitToolName = GitReadToolName | GitWriteToolName;

export type GitOptions = ToolkitOptions<GitToolName> & {
  /** Repository root directory. */
  rootDir: string;
  /** When true (default), only read-only inspection tools are registered. */
  readOnly?: boolean | undefined;
  /** Maximum bytes collected from git stdout/stderr. Default 512_000. */
  maxOutputBytes?: number | undefined;
  /** Maximum characters returned to the model. Default 16_000. */
  maxOutputChars?: number | undefined;
  /** Path or binary name for git. Default `"git"`. */
  gitBinary?: string | undefined;
};

const GIT_ENV_KEYS = [
  "PATH",
  "HOME",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "SYSTEMROOT",
  "TMP",
  "TEMP",
  "TMPDIR",
  "COMSPEC",
  "PATHEXT",
] as const;

const READONLY_INSTRUCTIONS =
  "Use git tools to inspect repository status, diffs, commits, and branches inside the workspace root.";

const READWRITE_INSTRUCTIONS =
  "Use git tools to inspect the repository and stage or commit changes inside the workspace root. Inspect status and diff before committing.";

export function git(options: GitOptions): Toolkit {
  const trimmedRoot = options.rootDir.trim();

  if (trimmedRoot.length === 0) {
    throw new TypeError("git rootDir must not be empty.");
  }

  const readOnly = options.readOnly ?? true;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const maxOutputBytes = options.maxOutputBytes ?? 512_000;
  const maxOutputChars = options.maxOutputChars ?? 16_000;
  const gitBinary = (options.gitBinary ?? "git").trim();

  if (gitBinary.length === 0) {
    throw new TypeError("git gitBinary must not be empty.");
  }

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError("git timeoutMs must be a positive finite number.");
  }

  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes <= 0) {
    throw new RangeError("git maxOutputBytes must be a positive safe integer.");
  }

  if (!Number.isSafeInteger(maxOutputChars) || maxOutputChars <= 0) {
    throw new RangeError("git maxOutputChars must be a positive safe integer.");
  }

  let rootPromise: Promise<string> | undefined;
  const getRoot = (): Promise<string> => {
    if (rootPromise === undefined) {
      rootPromise = resolveCanonicalRoot(trimmedRoot).catch((error) => {
        rootPromise = undefined;
        throw error;
      });
    }

    return rootPromise;
  };

  const runGitRaw = async (
    gitArgs: readonly string[],
    abortSignal: AbortSignal | undefined,
  ): Promise<{ stdout: string; byteTruncated: boolean }> => {
    const canonicalRoot = await getRoot();
    const env: NodeJS.ProcessEnv = {
      GIT_TERMINAL_PROMPT: "0",
      LC_ALL: "C",
    };

    for (const key of GIT_ENV_KEYS) {
      const value = process.env[key];

      if (value !== undefined) env[key] = value;
    }

    const parentDir = path.dirname(canonicalRoot);

    if (parentDir !== canonicalRoot) {
      env.GIT_CEILING_DIRECTORIES = parentDir;
    }

    const result = await executeChildProcess({
      file: gitBinary,
      args: ["--no-pager", "--literal-pathspecs", "-c", "core.fsmonitor=false", ...gitArgs],
      cwd: canonicalRoot,
      env,
      timeoutMs,
      maxOutputBytes,
      abortSignal,
    });

    if (result.timedOut) {
      throw new Error(`git command timed out after ${timeoutMs}ms.`);
    }

    if (result.exitCode !== 0) {
      const rawDetails =
        result.stderr.trim() || result.stdout.trim() || `exit code ${result.exitCode}`;
      const details = truncateText(rawDetails, Math.min(maxOutputChars, 4_000)).text;
      throw new Error(`git failed: ${details}`);
    }

    return {
      stdout: result.stdout,
      byteTruncated: result.byteTruncated,
    };
  };

  const runGit = async (
    gitArgs: readonly string[],
    abortSignal: AbortSignal | undefined,
  ): Promise<{ output: string; truncated: boolean }> => {
    const raw = await runGitRaw(gitArgs, abortSignal);
    const bounded = truncateText(raw.stdout, maxOutputChars);
    return {
      output: bounded.text,
      truncated: raw.byteTruncated || bounded.truncated,
    };
  };

  const resolveRepoPath = async (requestedPath: string): Promise<string> => {
    const canonicalRoot = await getRoot();

    if (requestedPath.includes("\0")) {
      throw new Error("Path must not contain null bytes.");
    }

    const normalizedInput = requestedPath.trim() === "" ? "." : requestedPath;
    const candidate = path.resolve(canonicalRoot, normalizedInput);

    if (!isPathWithinRoot(canonicalRoot, candidate)) {
      throw new Error(`Path "${requestedPath}" escapes the configured rootDir.`);
    }

    if (candidate === canonicalRoot) {
      return ".";
    }

    const parentSafe = await resolveSafePath(canonicalRoot, path.dirname(candidate), {
      allowMissing: true,
    });
    const finalPath = path.join(parentSafe, path.basename(candidate));

    if (!isPathWithinRoot(canonicalRoot, finalPath)) {
      throw new Error(`Path "${requestedPath}" escapes the configured rootDir.`);
    }

    return toRelativePosixPath(canonicalRoot, finalPath);
  };

  const statusTool = createTool({
    name: "git_status",
    description: "Inspect working tree status and active branch.",
    inputSchema: z.object({}),
    async handler(_args, context) {
      const result = await runGit(["status", "--porcelain=v1", "--branch"], context?.abortSignal);
      return {
        status: result.output,
        truncated: result.truncated,
      };
    },
  });

  const diffTool = createTool({
    name: "git_diff",
    description: "Show working tree, staged, or ref diff.",
    inputSchema: z.object({
      staged: z.boolean().optional().describe("Diff staged changes instead of unstaged changes."),
      ref: z.string().optional().describe("Optional commit, branch, or range ref to diff against."),
      path: z.string().optional().describe("Optional workspace-relative path to scope the diff."),
    }),
    async handler(args, context) {
      const gitArgs = ["diff", "--no-color", "--no-ext-diff", "--no-textconv"];

      if (args.staged === true) {
        gitArgs.push("--cached");
      }

      if (args.ref !== undefined) {
        gitArgs.push(assertSafeGitRef(args.ref));
      }

      gitArgs.push("--");

      if (args.path !== undefined) {
        gitArgs.push(await resolveRepoPath(args.path));
      }

      const result = await runGit(gitArgs, context?.abortSignal);
      return {
        diff: result.output,
        truncated: result.truncated,
      };
    },
  });

  const logTool = createTool({
    name: "git_log",
    description: "Show recent commit history.",
    inputSchema: z.object({
      maxCount: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .describe("Maximum number of commits to show (1-50, default 10)."),
      ref: z.string().optional().describe("Optional branch, tag, or commit ref."),
      path: z.string().optional().describe("Optional workspace-relative file or directory path."),
    }),
    async handler(args, context) {
      const limit = args.maxCount ?? 10;
      const gitArgs = [
        "log",
        "--no-color",
        "--no-ext-diff",
        "--no-textconv",
        `--max-count=${limit}`,
        "--format=%H%x09%ad%x09%an%x09%s",
        "--date=iso-strict",
      ];

      if (args.ref !== undefined) {
        gitArgs.push(assertSafeGitRef(args.ref));
      }

      gitArgs.push("--");

      if (args.path !== undefined) {
        gitArgs.push(await resolveRepoPath(args.path));
      }

      const raw = await runGitRaw(gitArgs, context?.abortSignal);
      const rawLines = raw.stdout.split(/\r?\n/);

      if (raw.byteTruncated && rawLines.length > 0) {
        rawLines.pop();
      }

      const commits: { hash: string; date: string; author: string; subject: string }[] = [];
      let totalChars = 0;
      let charTruncated = false;

      for (const line of rawLines) {
        if (line.length === 0) continue;

        if (totalChars + line.length > maxOutputChars && commits.length > 0) {
          charTruncated = true;
          break;
        }

        totalChars += line.length + 1;
        const [hash = "", date = "", author = "", ...subjectParts] = line.split("\t");
        commits.push({
          hash,
          date,
          author,
          subject: truncateText(subjectParts.join("\t"), maxOutputChars).text,
        });
      }

      return { commits, truncated: raw.byteTruncated || charTruncated };
    },
  });

  const showTool = createTool({
    name: "git_show",
    description: "Inspect a specific commit or git object.",
    inputSchema: z.object({
      ref: z.string().min(1).describe("Commit hash, branch, or tag to inspect."),
      statOnly: z
        .boolean()
        .optional()
        .describe("When true, return commit metadata and diffstat only."),
    }),
    async handler(args, context) {
      const safeRef = assertSafeGitRef(args.ref);
      const gitArgs = ["show", "--no-color", "--no-ext-diff", "--no-textconv"];

      if (args.statOnly === true) {
        gitArgs.push("--stat", "--format=fuller");
      }

      gitArgs.push(safeRef, "--");
      const result = await runGit(gitArgs, context?.abortSignal);
      return { content: result.output, truncated: result.truncated };
    },
  });

  const branchTool = createTool({
    name: "git_branch",
    description: "List local branches and identify the active branch.",
    inputSchema: z.object({}),
    async handler(_args, context) {
      const raw = await runGitRaw(
        ["branch", "--list", "--no-color", "--format=%(HEAD)%09%(refname:short)"],
        context?.abortSignal,
      );
      const rawLines = raw.stdout.split(/\r?\n/);

      if (raw.byteTruncated && rawLines.length > 0) {
        rawLines.pop();
      }

      let current: string | null = null;
      const branches: string[] = [];
      let totalChars = 0;
      let charTruncated = false;

      for (const line of rawLines) {
        if (line.length === 0) continue;

        if (totalChars + line.length > maxOutputChars && branches.length > 0) {
          charTruncated = true;
          break;
        }

        totalChars += line.length + 1;
        const [headMarker, branchName] = line.split("\t");

        if (branchName !== undefined && branchName.length > 0) {
          branches.push(branchName);

          if (headMarker === "*") {
            current = branchName;
          }
        }
      }

      return { current, branches, truncated: raw.byteTruncated || charTruncated };
    },
  });

  const tools: AnyTool[] = [statusTool, diffTool, logTool, showTool, branchTool];

  if (!readOnly) {
    const stageTool = createTool({
      name: "git_stage",
      description: "Stage workspace files for the next commit.",
      inputSchema: z.object({
        paths: z.array(z.string().min(1)).min(1).describe("Workspace-relative paths to stage."),
      }),
      async handler(args, context) {
        const resolvedPaths: string[] = [];

        for (const item of args.paths) {
          resolvedPaths.push(await resolveRepoPath(item));
        }

        await runGit(["add", "--", ...resolvedPaths], context?.abortSignal);
        return { staged: resolvedPaths };
      },
    });

    const commitTool = createTool({
      name: "git_commit",
      description: "Create a git commit from currently staged changes.",
      requiresApproval: true,
      inputSchema: z.object({
        message: z.string().min(1).describe("Commit message."),
      }),
      async handler(args, context) {
        const message = args.message.trim();

        if (message.length === 0 || message.includes("\0")) {
          throw new Error("Commit message must be non-empty and free of null bytes.");
        }

        const result = await runGit(["commit", "-m", message], context?.abortSignal);
        return { output: result.output.trim(), truncated: result.truncated };
      },
    });

    tools.push(stageTool, commitTool);
  }

  const toolkitOptions: ToolkitOptions<GitToolName> = {
    instructions:
      options.instructions ?? (readOnly ? READONLY_INSTRUCTIONS : READWRITE_INSTRUCTIONS),
  };

  if (options.include !== undefined) toolkitOptions.include = options.include;

  if (options.exclude !== undefined) toolkitOptions.exclude = options.exclude;

  if (options.prefix !== undefined) toolkitOptions.prefix = options.prefix;

  if (options.requiresApproval !== undefined) {
    toolkitOptions.requiresApproval = options.requiresApproval;
  }

  return createToolkit(
    {
      name: "git",
      tools,
    },
    toolkitOptions,
  );
}

function assertSafeGitRef(raw: string): string {
  const trimmed = raw.trim();

  if (trimmed.length === 0) {
    throw new Error("Git ref must not be empty.");
  }

  if (trimmed.startsWith("-")) {
    throw new Error(`Invalid git ref "${raw}": refs must not start with "-".`);
  }

  if (/[\0\r\n]/.test(trimmed)) {
    throw new Error("Git ref must not contain control characters.");
  }

  return trimmed;
}
