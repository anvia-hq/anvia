import { type AnyTool, createTool } from "@anvia/core/tool";
import { z } from "zod";
import { isSandboxPortSession, isSandboxProcessSession } from "./capabilities";
import { SandboxToolPolicyError } from "./errors";
import type {
  SandboxExecOptions,
  SandboxExecResult,
  SandboxPortSession,
  SandboxProcessInfo,
  SandboxProcessSession,
  SandboxProcessStartOptions,
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

const emptyInput = z.object({});

const startProcessInput = z.object({
  command: z.string().min(1).describe("Executable to run as a managed sandbox process."),
  args: z.array(z.string()).optional().describe("Command arguments."),
  cwd: z.string().optional().describe("Relative working directory inside the sandbox."),
  env: z
    .record(z.string(), z.string())
    .optional()
    .describe("Environment variables for this process."),
});

const processIdInput = z.object({
  processId: z.string().min(1).describe("Managed process identifier."),
});

const readProcessLogsInput = processIdInput.extend({
  tailBytes: z
    .number()
    .int()
    .nonnegative()
    .max(1024 * 1024)
    .optional()
    .describe("Maximum trailing bytes to return from each output stream."),
});

const waitForPortInput = z.object({
  containerPort: z
    .number()
    .int()
    .min(1)
    .max(65_535)
    .describe("Pre-authorized TCP port inside the sandbox container."),
  timeoutMs: z
    .number()
    .int()
    .positive()
    .max(300_000)
    .optional()
    .describe("Maximum time to wait for the port to accept connections."),
});

const textOutput = z.string();
const maxToolLogBytes = 1024 * 1024;
const sandboxToolMetadataKey = Symbol.for("anvia.sandbox.tool.metadata");

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

  const portToolsRequested = include.has("list_ports") || include.has("wait_for_port");
  const portSession = portToolsRequested ? requirePortSession(session) : undefined;
  if (include.has("list_ports") && portSession !== undefined) {
    tools.push(createListPortsTool(portSession));
  }

  const processToolsRequested =
    include.has("start_process") ||
    include.has("list_processes") ||
    include.has("read_process_logs") ||
    include.has("stop_process");
  if (include.has("wait_for_port") || processToolsRequested) assertProcessToolPolicy(options);
  const processSession = processToolsRequested ? requireProcessSession(session) : undefined;
  if (include.has("start_process") && processSession !== undefined) {
    tools.push(createStartProcessTool(processSession, options));
  }

  if (include.has("list_processes") && processSession !== undefined) {
    tools.push(createListProcessesTool(processSession));
  }

  if (include.has("read_process_logs") && processSession !== undefined) {
    tools.push(createReadProcessLogsTool(processSession, options));
  }

  if (include.has("stop_process") && processSession !== undefined) {
    tools.push(createStopProcessTool(processSession, options));
  }

  if (include.has("wait_for_port") && portSession !== undefined) {
    tools.push(createWaitForPortTool(portSession, options));
  }

  for (const tool of tools) {
    Object.defineProperty(tool, sandboxToolMetadataKey, {
      value: { session },
      enumerable: false,
    });
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

function createListPortsTool(session: SandboxPortSession): AnyTool {
  return createTool({
    name: "list_ports",
    description:
      "List pre-authorized sandbox preview ports. Servers must bind to 0.0.0.0 on a listed container port.",
    input: emptyInput,
    output: textOutput,
    execute: async () => {
      if (session.publishedPorts.length === 0) {
        return "No sandbox ports are published.";
      }
      return session.publishedPorts
        .map((port) => `${port.containerPort}/${port.protocol}\t${port.host}:${port.hostPort}`)
        .join("\n");
    },
  });
}

function createStartProcessTool(
  session: SandboxProcessSession,
  options: SandboxToolsOptions,
): AnyTool {
  return createTool({
    name: "start_process",
    description:
      "Start a managed long-running process inside the sandbox. Use list_ports first and bind web servers to 0.0.0.0.",
    input: startProcessInput,
    output: textOutput,
    execute: async ({ command, args, cwd, env }) => {
      assertCommandAllowed(command, options);
      const processOptions: SandboxProcessStartOptions = { command };
      if (args !== undefined) processOptions.args = args;
      if (cwd !== undefined) processOptions.cwd = cwd;
      if (env !== undefined) processOptions.env = env;
      return formatProcessInfo(await session.startProcess(processOptions));
    },
  });
}

function createListProcessesTool(session: SandboxProcessSession): AnyTool {
  return createTool({
    name: "list_processes",
    description: "List managed sandbox processes and their current status.",
    input: emptyInput,
    output: textOutput,
    execute: async () => {
      const processes = await session.listProcesses();
      if (processes.length === 0) return "No managed processes.";
      return processes.map(formatProcessInfo).join("\n\n");
    },
  });
}

function createReadProcessLogsTool(
  session: SandboxProcessSession,
  options: SandboxToolsOptions,
): AnyTool {
  return createTool({
    name: "read_process_logs",
    description: "Read recent stdout and stderr from a managed sandbox process.",
    input: readProcessLogsInput,
    output: textOutput,
    execute: async ({ processId, tailBytes }) => {
      const configuredMaxLogBytes = options.process?.maxLogBytes ?? 64 * 1024;
      if (!Number.isInteger(configuredMaxLogBytes) || configuredMaxLogBytes < 0) {
        throw new SandboxToolPolicyError("Process maxLogBytes must be a non-negative integer.");
      }
      const maxLogBytes = Math.min(configuredMaxLogBytes, maxToolLogBytes);
      const effectiveTailBytes = tailBytes ?? maxLogBytes;
      if (effectiveTailBytes > maxLogBytes) {
        throw new SandboxToolPolicyError(
          `Process log request exceeds sandbox tool policy (${effectiveTailBytes} > ${maxLogBytes}).`,
        );
      }
      const logs = await session.readProcessLogs(processId, {
        tailBytes: effectiveTailBytes,
      });
      const parts: string[] = [];
      if (logs.stdout.length > 0) parts.push(`stdout:\n${logs.stdout.trimEnd()}`);
      if (logs.stderr.length > 0) parts.push(`stderr:\n${logs.stderr.trimEnd()}`);
      if (logs.stdoutTruncated || logs.stderrTruncated) parts.push("output_truncated: true");
      return parts.length > 0 ? parts.join("\n\n") : "No process output.";
    },
  });
}

function createStopProcessTool(
  session: SandboxProcessSession,
  options: SandboxToolsOptions,
): AnyTool {
  return createTool({
    name: "stop_process",
    description: "Stop a managed sandbox process.",
    input: processIdInput,
    output: textOutput,
    execute: async ({ processId }) =>
      formatProcessInfo(
        await session.stopProcess(processId, {
          gracePeriodMs: options.process?.stopGracePeriodMs ?? 5_000,
        }),
      ),
  });
}

function createWaitForPortTool(session: SandboxPortSession, options: SandboxToolsOptions): AnyTool {
  return createTool({
    name: "wait_for_port",
    description: "Wait until a pre-authorized sandbox TCP port is accepting connections.",
    input: waitForPortInput,
    output: textOutput,
    execute: async ({ containerPort, timeoutMs }) => {
      const effectiveTimeoutMs = timeoutMs ?? options.process?.defaultWaitTimeoutMs ?? 30_000;
      const maxWaitTimeoutMs = options.process?.maxWaitTimeoutMs ?? 300_000;
      if (effectiveTimeoutMs > maxWaitTimeoutMs) {
        throw new SandboxToolPolicyError(
          `Port wait timeout exceeds sandbox tool policy (${effectiveTimeoutMs} > ${maxWaitTimeoutMs}).`,
        );
      }
      const port = await session.waitForPort(containerPort, {
        timeoutMs: effectiveTimeoutMs,
      });
      return `ready: ${port.containerPort}/${port.protocol} -> ${port.host}:${port.hostPort}`;
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

function formatProcessInfo(process: SandboxProcessInfo): string {
  const parts = [
    `process_id: ${process.id}`,
    `status: ${process.status}`,
    `command: ${[process.command, ...process.args].join(" ")}`,
  ];
  if (process.exitCode !== undefined) parts.push(`exit_code: ${process.exitCode}`);
  return parts.join("\n");
}

function requirePortSession(session: SandboxSession): SandboxPortSession {
  if (!isSandboxPortSession(session)) {
    throw new SandboxToolPolicyError("The sandbox session does not support published port tools.");
  }
  return session;
}

function requireProcessSession(session: SandboxSession): SandboxProcessSession {
  if (!isSandboxProcessSession(session)) {
    throw new SandboxToolPolicyError("The sandbox session does not support managed process tools.");
  }
  return session;
}

function assertProcessToolPolicy(options: SandboxToolsOptions): void {
  const policy = options.process;
  if (policy === undefined) return;
  if (
    policy.maxLogBytes !== undefined &&
    (!Number.isInteger(policy.maxLogBytes) ||
      policy.maxLogBytes < 0 ||
      policy.maxLogBytes > maxToolLogBytes)
  ) {
    throw new SandboxToolPolicyError(
      `Process maxLogBytes must be an integer from 0 to ${maxToolLogBytes}.`,
    );
  }
  const maxWaitTimeoutMs = policy.maxWaitTimeoutMs ?? 300_000;
  if (!Number.isInteger(maxWaitTimeoutMs) || maxWaitTimeoutMs <= 0 || maxWaitTimeoutMs > 300_000) {
    throw new SandboxToolPolicyError(
      "Process maxWaitTimeoutMs must be an integer from 1 to 300000.",
    );
  }
  if (
    policy.defaultWaitTimeoutMs !== undefined &&
    (!Number.isInteger(policy.defaultWaitTimeoutMs) ||
      policy.defaultWaitTimeoutMs <= 0 ||
      policy.defaultWaitTimeoutMs > maxWaitTimeoutMs)
  ) {
    throw new SandboxToolPolicyError(
      "Process defaultWaitTimeoutMs must be positive and no greater than maxWaitTimeoutMs.",
    );
  }
  if (
    policy.stopGracePeriodMs !== undefined &&
    (!Number.isInteger(policy.stopGracePeriodMs) || policy.stopGracePeriodMs < 0)
  ) {
    throw new SandboxToolPolicyError("Process stopGracePeriodMs must be a non-negative integer.");
  }
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
