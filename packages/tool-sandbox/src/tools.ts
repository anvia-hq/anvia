import { type AnyTool, createTool } from "@anvia/core/tool";
import { z } from "zod";
import { SandboxToolPolicyError } from "./errors";
import type {
  SandboxExecOptions,
  SandboxExecResult,
  SandboxSession,
  SandboxToolName,
  SandboxToolsOptions,
} from "./types";

const execCommandInput = z.object({
  command: z.string().min(1).describe("Executable to run inside the sandbox workspace."),
  args: z.array(z.string()).optional().describe("Command arguments."),
  cwd: z.string().optional().describe("Relative working directory inside the sandbox."),
  env: z
    .record(z.string(), z.string())
    .optional()
    .describe("Environment variables for this command."),
  timeoutMs: z
    .number()
    .int()
    .positive()
    .max(300_000)
    .optional()
    .describe("Optional command timeout in milliseconds."),
  input: z.string().optional().describe("Optional stdin text to pass to the command."),
});

const readFileInput = z.object({
  path: z.string().min(1).describe("Relative file path inside the sandbox."),
});

const writeFileInput = z.object({
  path: z.string().min(1).describe("Relative file path inside the sandbox."),
  content: z.string().describe("Complete text content to write."),
});

const listFilesInput = z.object({
  path: z
    .string()
    .optional()
    .describe("Relative directory path inside the sandbox. Defaults to root."),
});

const textOutput = z.string();

export function createSandboxTools(
  session: SandboxSession,
  options: SandboxToolsOptions = {},
): AnyTool[] {
  const include = new Set<SandboxToolName>(
    options.allow ?? options.include ?? ["exec_command", "read_file", "write_file", "list_files"],
  );
  const tools: AnyTool[] = [];

  if (include.has("exec_command")) {
    tools.push(createExecCommandTool(session, options));
  }

  if (include.has("read_file")) {
    tools.push(createReadFileTool(session, options));
  }

  if (include.has("write_file")) {
    tools.push(createWriteFileTool(session, options));
  }

  if (include.has("list_files")) {
    tools.push(createListFilesTool(session));
  }

  return tools;
}

function createExecCommandTool(session: SandboxSession, options: SandboxToolsOptions): AnyTool {
  const policy = options.exec ?? {};

  return createTool({
    name: "exec_command",
    description:
      "Run a command inside the sandbox workspace. Use structured args instead of shell quoting.",
    input: execCommandInput,
    output: textOutput,
    execute: async ({ command, args, cwd, env, timeoutMs, input }) => {
      assertCommandAllowed(command, options);

      const execOptions: SandboxExecOptions = {
        command,
      };

      if (args !== undefined) {
        execOptions.args = args;
      }
      if (cwd !== undefined) {
        execOptions.cwd = cwd;
      }
      if (env !== undefined) {
        execOptions.env = env;
      }
      const effectiveTimeoutMs = timeoutMs ?? policy.defaultTimeoutMs ?? options.execTimeoutMs;
      if (effectiveTimeoutMs !== undefined) {
        assertTimeoutAllowed(effectiveTimeoutMs, options);
        execOptions.timeoutMs = effectiveTimeoutMs;
      }
      if (input !== undefined) {
        execOptions.input = input;
      }

      const result = await session.exec(execOptions);

      return formatExecResult(result);
    },
  });
}

function createReadFileTool(session: SandboxSession, options: SandboxToolsOptions): AnyTool {
  return createTool({
    name: "read_file",
    description: "Read a text file from the sandbox workspace.",
    input: readFileInput,
    output: textOutput,
    execute: async ({ path }) => {
      const content = await session.readTextFile(path);
      assertReadAllowed(content, options);
      return content;
    },
  });
}

function createWriteFileTool(session: SandboxSession, options: SandboxToolsOptions): AnyTool {
  return createTool({
    name: "write_file",
    description: "Write a text file inside the sandbox workspace. Creates parent directories.",
    input: writeFileInput,
    output: textOutput,
    execute: async ({ path, content }) => {
      assertContentAllowed(content, options);
      await session.writeTextFile(path, content);
      return `Wrote ${path}`;
    },
  });
}

function createListFilesTool(session: SandboxSession): AnyTool {
  return createTool({
    name: "list_files",
    description: "List files and directories inside the sandbox workspace.",
    input: listFilesInput,
    output: textOutput,
    execute: async ({ path }) => {
      const entries = await session.listFiles(path);

      if (entries.length === 0) {
        return "No files found.";
      }

      return entries
        .map((entry) => {
          const size = entry.size === undefined ? "" : ` ${entry.size}b`;
          return `${entry.type}${size}\t${entry.path}`;
        })
        .join("\n");
    },
  });
}

function formatExecResult(result: SandboxExecResult): string {
  const parts = [`exit_code: ${result.exitCode}`];

  if (result.timedOut) {
    parts.push("timed_out: true");
  }

  if (result.aborted) {
    parts.push("aborted: true");
  }

  if (result.stdout.length > 0) {
    parts.push(`stdout:\n${result.stdout.trimEnd()}`);
  }

  if (result.stderr.length > 0) {
    parts.push(`stderr:\n${result.stderr.trimEnd()}`);
  }

  if (result.stdoutTruncated || result.stderrTruncated) {
    parts.push("output_truncated: true");
  }

  return parts.join("\n\n");
}

function assertCommandAllowed(command: string, options: SandboxToolsOptions): void {
  const policy = options.exec;

  if (policy?.blockedCommands?.includes(command)) {
    throw new SandboxToolPolicyError(`Command is blocked by sandbox tool policy: ${command}`);
  }

  if (policy?.allowedCommands !== undefined && !policy.allowedCommands.includes(command)) {
    throw new SandboxToolPolicyError(`Command is not allowed by sandbox tool policy: ${command}`);
  }
}

function assertTimeoutAllowed(timeoutMs: number, options: SandboxToolsOptions): void {
  const maxTimeoutMs = options.exec?.maxTimeoutMs;

  if (maxTimeoutMs !== undefined && timeoutMs > maxTimeoutMs) {
    throw new SandboxToolPolicyError(
      `Command timeout exceeds sandbox tool policy (${timeoutMs} > ${maxTimeoutMs}).`,
    );
  }
}

function assertContentAllowed(content: string, options: SandboxToolsOptions): void {
  const maxBytes = options.writeFile?.maxBytes;

  if (maxBytes !== undefined && Buffer.byteLength(content) > maxBytes) {
    throw new SandboxToolPolicyError("File content exceeds sandbox tool policy.");
  }
}

function assertReadAllowed(content: string, options: SandboxToolsOptions): void {
  const maxBytes = options.readFile?.maxBytes;

  if (maxBytes !== undefined && Buffer.byteLength(content) > maxBytes) {
    throw new SandboxToolPolicyError("File content exceeds sandbox tool policy.");
  }
}
