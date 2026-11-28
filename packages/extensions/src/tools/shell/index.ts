import { stat } from "node:fs/promises";
import path from "node:path";
import { createTool, createToolkit, type Toolkit, type ToolkitOptions } from "@anvia/core/tool";
import { z } from "zod";
import { executeChildProcess } from "../../internal/child-process";
import { truncateText } from "../../internal/truncate";
import { resolveCanonicalRoot, resolveSafePath, toRelativePosixPath } from "../fs/path-safety";

export type ShellToolName = "run_command";
export type ShellExecutionMode = "execFile" | "shell";

export type ShellOptions = ToolkitOptions<ShellToolName> & {
  /** Workspace root directory commands are scoped to. */
  rootDir: string;
  /** Execution mode. `"execFile"` (default) avoids shell interpolation; `"shell"` runs via the system shell. */
  mode?: ShellExecutionMode | undefined;
  /** Allow per-call `cwd` relative to `rootDir`. Default true. */
  allowSubdirCwd?: boolean | undefined;
  /** Optional allowlist of permitted executable names (bare names reject path separators) or explicit paths. Empty array fails closed. */
  allowedCommands?: readonly string[] | undefined;
  /** Optional denylist of forbidden executable names (basenames). */
  deniedCommands?: readonly string[] | undefined;
  /** Extra environment variables passed to spawned commands. */
  env?: Record<string, string> | undefined;
  /** Inherit the parent `process.env`. Default false to prevent leaking API keys or secrets. */
  inheritEnv?: boolean | undefined;
  /** Maximum combined stdout/stderr bytes collected from the child process. Default 256_000. */
  maxOutputBytes?: number | undefined;
  /** Maximum characters returned for each of stdout and stderr. Default 16_000. */
  maxOutputChars?: number | undefined;
};

export type ShellCommandResult = {
  command: string;
  cwd: string;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  truncated: boolean;
  stdout: string;
  stderr: string;
};

const SAFE_ENV_KEYS = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "TMPDIR",
  "TEMP",
  "TMP",
  "SHELL",
  "SYSTEMROOT",
  "COMSPEC",
  "PATHEXT",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
] as const;

const STRICT_SHELL_METACHAR_PATTERN = /[;&|`$<>(){}[\]'"\\=~#!%^]/;
const WIN32_EXEC_EXT_PATTERN = /\.(?:exe|cmd|bat|com|ps1)$/i;

const EXEC_FILE_INSTRUCTIONS =
  "Use run_command to execute local workspace commands. Pass the executable in `command` and separate arguments in `args`. Keep `cwd` within the workspace root.";

const SHELL_MODE_INSTRUCTIONS =
  "Use run_command to execute shell commands inside the workspace root. Keep commands concise and avoid destructive operations unless explicitly requested.";

export function shell(options: ShellOptions): Toolkit {
  const trimmedRoot = options.rootDir.trim();

  if (trimmedRoot.length === 0) {
    throw new TypeError("shell rootDir must not be empty.");
  }

  if (options.allowedCommands !== undefined && options.allowedCommands.length === 0) {
    throw new TypeError("shell allowedCommands must not be empty when specified.");
  }

  const mode = options.mode ?? "execFile";
  const allowSubdirCwd = options.allowSubdirCwd ?? true;
  const inheritEnv = options.inheritEnv ?? false;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxOutputBytes = options.maxOutputBytes ?? 256_000;
  const maxOutputChars = options.maxOutputChars ?? 16_000;

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError("shell timeoutMs must be a positive finite number.");
  }

  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes <= 0) {
    throw new RangeError("shell maxOutputBytes must be a positive safe integer.");
  }

  if (!Number.isSafeInteger(maxOutputChars) || maxOutputChars <= 0) {
    throw new RangeError("shell maxOutputChars must be a positive safe integer.");
  }

  const allowPolicy =
    options.allowedCommands === undefined ? undefined : compileAllowPolicy(options.allowedCommands);
  const deniedSet =
    options.deniedCommands === undefined
      ? undefined
      : new Set(options.deniedCommands.map(normalizeBasenameForPolicy));

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

  const inputSchema =
    mode === "execFile"
      ? z.object({
          command: z.string().min(1).describe("Executable name or path to run."),
          args: z
            .array(z.string())
            .optional()
            .describe("Command arguments passed directly without shell interpolation."),
          cwd: z.string().optional().describe("Working directory relative to the workspace root."),
        })
      : z.object({
          command: z.string().min(1).describe("Shell command line to run."),
          cwd: z.string().optional().describe("Working directory relative to the workspace root."),
        });

  const runCommandTool = createTool({
    name: "run_command",
    description:
      mode === "execFile"
        ? "Execute a command inside the workspace without shell interpolation."
        : "Execute a shell command inside the workspace.",
    requiresApproval: true,
    inputSchema,
    async handler(args, context): Promise<ShellCommandResult> {
      const canonicalRoot = await getRoot();
      const commandText = args.command.trim();

      if (commandText.length === 0 || commandText.includes("\0")) {
        throw new Error("Command must be a non-empty string without null bytes.");
      }

      const rawArgs =
        "args" in args && Array.isArray(args.args) ? (args.args as readonly string[]) : undefined;

      if (rawArgs !== undefined) {
        for (const arg of rawArgs) {
          if (arg.includes("\0")) {
            throw new Error("Command arguments must not contain null bytes.");
          }
        }
      }

      const cwd = await resolveCommandCwd(canonicalRoot, args.cwd, allowSubdirCwd);
      const hasCommandPolicy = allowPolicy !== undefined || deniedSet !== undefined;
      const commandToken = extractCommandToken(commandText, mode, hasCommandPolicy);
      const baseName = normalizeBasenameForPolicy(commandToken);

      if (deniedSet !== undefined && deniedSet.has(baseName)) {
        throw new Error(`Command "${baseName}" is denied by shell policy.`);
      }

      if (allowPolicy !== undefined && !isCommandAllowed(commandToken, allowPolicy)) {
        throw new Error(`Command "${commandToken}" is not in shell allowedCommands.`);
      }

      const env = buildCommandEnv(inheritEnv, options.env);
      const spawnSpec = resolveSpawnSpec(mode, commandText, rawArgs);

      const execution = await executeChildProcess({
        file: spawnSpec.file,
        args: spawnSpec.args,
        cwd,
        env,
        timeoutMs,
        maxOutputBytes,
        abortSignal: context?.abortSignal,
      });

      const stdout = truncateText(execution.stdout, maxOutputChars);
      const stderr = truncateText(execution.stderr, maxOutputChars);

      return {
        command: commandText,
        cwd: toRelativePosixPath(canonicalRoot, cwd),
        exitCode: execution.exitCode,
        signal: execution.signal,
        timedOut: execution.timedOut,
        truncated: execution.byteTruncated || stdout.truncated || stderr.truncated,
        stdout: stdout.text,
        stderr: stderr.text,
      };
    },
  });

  const toolkitOptions: ToolkitOptions<ShellToolName> = {
    instructions:
      options.instructions ??
      (mode === "execFile" ? EXEC_FILE_INSTRUCTIONS : SHELL_MODE_INSTRUCTIONS),
  };

  if (options.include !== undefined) toolkitOptions.include = options.include;

  if (options.exclude !== undefined) toolkitOptions.exclude = options.exclude;

  if (options.prefix !== undefined) toolkitOptions.prefix = options.prefix;

  if (options.requiresApproval !== undefined) {
    toolkitOptions.requiresApproval = options.requiresApproval;
  }

  return createToolkit(
    {
      name: "shell",
      tools: [runCommandTool],
    },
    toolkitOptions,
  );
}

type CompiledAllowPolicy = {
  bareNames: Set<string>;
  exactPaths: Set<string>;
};

function compileAllowPolicy(commands: readonly string[]): CompiledAllowPolicy {
  const bareNames = new Set<string>();
  const exactPaths = new Set<string>();

  for (const raw of commands) {
    const trimmed = raw.trim();

    if (trimmed.length === 0) {
      throw new TypeError("Command names in shell policy must not be empty.");
    }

    if (hasPathSeparator(trimmed)) {
      exactPaths.add(normalizePathForPolicy(trimmed));
    } else {
      bareNames.add(normalizeBasenameForPolicy(trimmed));
    }
  }

  return { bareNames, exactPaths };
}

function isCommandAllowed(commandToken: string, policy: CompiledAllowPolicy): boolean {
  if (hasPathSeparator(commandToken)) {
    return policy.exactPaths.has(normalizePathForPolicy(commandToken));
  }

  return policy.bareNames.has(normalizeBasenameForPolicy(commandToken));
}

function hasPathSeparator(value: string): boolean {
  return value.includes("/") || value.includes("\\");
}

function normalizePathForPolicy(raw: string): string {
  const resolved = path.resolve(raw);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function normalizeBasenameForPolicy(raw: string): string {
  const trimmed = raw.trim();

  if (trimmed.length === 0) {
    throw new TypeError("Command names in shell policy must not be empty.");
  }

  const base = path.basename(trimmed);

  if (process.platform === "win32") {
    return base.toLowerCase().replace(WIN32_EXEC_EXT_PATTERN, "");
  }

  return base;
}

async function resolveCommandCwd(
  canonicalRoot: string,
  requestedCwd: string | undefined,
  allowSubdirCwd: boolean,
): Promise<string> {
  if (requestedCwd === undefined || requestedCwd.trim() === "" || requestedCwd.trim() === ".") {
    return canonicalRoot;
  }

  if (!allowSubdirCwd) {
    throw new Error("Per-call cwd is disabled for this shell toolkit.");
  }

  const resolved = await resolveSafePath(canonicalRoot, requestedCwd);
  const info = await stat(resolved);

  if (!info.isDirectory()) {
    throw new Error(`Working directory "${requestedCwd}" is not a directory.`);
  }

  return resolved;
}

function extractCommandToken(
  commandText: string,
  mode: ShellExecutionMode,
  enforceSingleCommand: boolean,
): string {
  if (mode === "execFile") {
    return commandText;
  }

  if (
    enforceSingleCommand &&
    (STRICT_SHELL_METACHAR_PATTERN.test(commandText) || hasControlChar(commandText))
  ) {
    throw new Error(
      "Shell metacharacters, quotes, assignments, and control characters are not permitted when allowedCommands or deniedCommands is configured.",
    );
  }

  const firstToken = commandText.split(/ +/)[0] ?? "";

  if (firstToken.length === 0) {
    throw new Error("Command must not be empty.");
  }

  return firstToken;
}

function hasControlChar(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);

    if (code < 0x20 || code === 0x7f) {
      return true;
    }
  }

  return false;
}

function resolveSpawnSpec(
  mode: ShellExecutionMode,
  commandText: string,
  args: readonly string[] | undefined,
): { file: string; args: readonly string[] } {
  if (mode === "execFile") {
    return { file: commandText, args: args ?? [] };
  }

  if (process.platform === "win32") {
    return {
      file: process.env.COMSPEC ?? "cmd.exe",
      args: ["/d", "/s", "/c", commandText],
    };
  }

  return {
    file: "/bin/sh",
    args: ["-c", commandText],
  };
}

function buildCommandEnv(
  inheritEnv: boolean,
  extraEnv: Record<string, string> | undefined,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};

  if (inheritEnv) {
    Object.assign(env, process.env);
  } else {
    for (const key of SAFE_ENV_KEYS) {
      const value = process.env[key];

      if (value !== undefined) {
        env[key] = value;
      }
    }
  }

  if (extraEnv !== undefined) {
    Object.assign(env, extraEnv);
  }

  return env;
}
