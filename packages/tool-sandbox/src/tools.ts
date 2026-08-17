import { type AnyTool, createTool } from "@anvia/core/tool";
import { z } from "zod";
import { decodeUtf8 } from "./docker-cli";
import { DockerSandboxError } from "./errors";
import type {
  CreateDockerSandboxToolsOptions,
  DockerSandboxCommandPolicy,
  DockerSandboxExecOptions,
  DockerSandboxExecResult,
  DockerSandboxProcessInfo,
  DockerSandboxRuntime,
  DockerSandboxToolName,
} from "./types";

const allToolNames = [
  "exec_command",
  "read_file",
  "write_file",
  "list_files",
  "list_ports",
  "start_process",
  "list_processes",
  "read_process_logs",
  "stop_process",
  "wait_for_port",
] as const satisfies readonly DockerSandboxToolName[];

const execCommandInput = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  cwd: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
  timeoutMs: z.number().int().positive().max(300_000).optional(),
  input: z.string().optional(),
});

const execResultOutput = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("exited"),
    exitCode: z.number().int(),
    stdout: z.string(),
    stderr: z.string(),
    durationMs: z.number().nonnegative(),
    stdoutTruncated: z.boolean(),
    stderrTruncated: z.boolean(),
  }),
  z.object({
    status: z.literal("timed_out"),
    stdout: z.string(),
    stderr: z.string(),
    durationMs: z.number().nonnegative(),
    stdoutTruncated: z.boolean(),
    stderrTruncated: z.boolean(),
  }),
]);

const readFileInput = z.object({
  path: z.string().min(1),
  startLine: z.number().int().positive().optional(),
  lineCount: z.number().int().positive().max(10_000).optional(),
});

const readFileOutput = z.object({
  content: z.string(),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive().nullable(),
  nextStartLine: z.number().int().positive().nullable(),
  truncated: z.boolean(),
  truncatedBy: z.enum(["lines", "bytes"]).nullable(),
});

const writeFileInput = z.object({
  path: z.string().min(1),
  content: z.string(),
});

const writeFileOutput = z.object({
  path: z.string(),
  bytesWritten: z.number().int().nonnegative(),
});

const listFilesInput = z.object({ path: z.string().optional() });
const fileEntryOutput = z.object({
  path: z.string(),
  type: z.enum(["file", "directory", "symlink", "other"]),
  size: z.number().int().nonnegative().optional(),
});
const listFilesOutput = z.object({
  path: z.string(),
  entries: z.array(fileEntryOutput),
});

const emptyInput = z.object({});
const publishedPortOutput = z.object({
  containerPort: z.number().int(),
  host: z.literal("127.0.0.1"),
  hostPort: z.number().int(),
  protocol: z.literal("tcp"),
});
const listPortsOutput = z.object({ ports: z.array(publishedPortOutput) });

const startProcessInput = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  cwd: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
});
const processInfoOutput = z.object({
  id: z.string(),
  command: z.string(),
  args: z.array(z.string()),
  cwd: z.string().optional(),
  status: z.enum(["running", "exited", "stopped"]),
  exitCode: z.number().int().optional(),
  startedAt: z.string(),
  endedAt: z.string().optional(),
});
const listProcessesOutput = z.object({ processes: z.array(processInfoOutput) });

const processIdInput = z.object({ processId: z.string().min(1) });
const readProcessLogsInput = processIdInput.extend({
  tailBytes: z
    .number()
    .int()
    .nonnegative()
    .max(1024 * 1024)
    .optional(),
});
const processLogsOutput = z.object({
  processId: z.string(),
  stdout: z.string(),
  stderr: z.string(),
  stdoutTruncated: z.boolean(),
  stderrTruncated: z.boolean(),
});

const waitForPortInput = z.object({
  containerPort: z.number().int().min(1).max(65_535),
  timeoutMs: z.number().int().positive().max(300_000).optional(),
});
const waitForPortOutput = z.object({ port: publishedPortOutput });

const defaultReadFileLineCount = 500;
const defaultReadFileMaxLineCount = 2_000;
const defaultReadFileMaxBytes = 64 * 1024;
const maxToolReadFileLines = 10_000;
const maxToolBytes = 1024 * 1024;
const maxToolTimeoutMs = 300_000;

export function createDockerSandboxTools(
  options: CreateDockerSandboxToolsOptions,
): readonly AnyTool[] {
  validateFactoryOptions(options);
  options = snapshotFactoryOptions(options);
  const selected = new Set(options.tools);
  const tools: AnyTool[] = [];

  for (const name of options.tools) {
    if (name === "exec_command") tools.push(createExecCommandTool(options));
    else if (name === "read_file") tools.push(createReadFileTool(options));
    else if (name === "write_file") tools.push(createWriteFileTool(options));
    else if (name === "list_files") tools.push(createListFilesTool(options.sandbox));
    else if (name === "list_ports") tools.push(createListPortsTool(options.sandbox));
    else if (name === "start_process") tools.push(createStartProcessTool(options));
    else if (name === "list_processes") tools.push(createListProcessesTool(options.sandbox));
    else if (name === "read_process_logs") tools.push(createReadProcessLogsTool(options));
    else if (name === "stop_process") tools.push(createStopProcessTool(options));
    else if (name === "wait_for_port") tools.push(createWaitForPortTool(options));
  }

  if (tools.length !== selected.size) {
    throw toolPolicyError("Sandbox tool selection contains an unsupported tool name.");
  }
  return Object.freeze(tools);
}

function createExecCommandTool(options: CreateDockerSandboxToolsOptions): AnyTool {
  return createTool({
    name: "exec_command",
    description: "Run one executable inside the sandbox with structured arguments.",
    inputSchema: execCommandInput,
    outputSchema: execResultOutput,
    execute: async ({ command, args, cwd, env, timeoutMs, input }, context) => {
      assertCommandAllowed(command, options.exec?.commands);
      const effectiveTimeoutMs = timeoutMs ?? options.exec?.defaultTimeoutMs;
      assertTimeoutAllowed(effectiveTimeoutMs, options.exec?.maxTimeoutMs);
      const execOptions: DockerSandboxExecOptions = {
        command,
        ...(args === undefined ? {} : { args }),
        ...(cwd === undefined ? {} : { cwd }),
        ...(env === undefined ? {} : { env }),
        ...(effectiveTimeoutMs === undefined ? {} : { timeoutMs: effectiveTimeoutMs }),
        ...(input === undefined ? {} : { input }),
        ...(context.abortSignal === undefined ? {} : { abortSignal: context.abortSignal }),
      };
      return serializeExecResult(await options.sandbox.exec(execOptions));
    },
  });
}

function createReadFileTool(options: CreateDockerSandboxToolsOptions): AnyTool {
  const limits = resolveReadFileLimits(options);
  return createTool({
    name: "read_file",
    description: "Read a bounded page of a UTF-8 text file from the sandbox workspace.",
    inputSchema: readFileInput,
    outputSchema: readFileOutput,
    execute: async ({ path, startLine, lineCount }, context) => {
      const effectiveLineCount = lineCount ?? limits.defaultLineCount;
      if (effectiveLineCount > limits.maxLineCount) {
        throw toolPolicyError(
          `File read line count exceeds policy (${effectiveLineCount} > ${limits.maxLineCount}).`,
        );
      }
      return options.sandbox.readTextFilePage({
        path,
        startLine: startLine ?? 1,
        lineCount: effectiveLineCount,
        maxBytes: limits.maxBytes,
        ...(context.abortSignal === undefined ? {} : { abortSignal: context.abortSignal }),
      });
    },
  });
}

function createWriteFileTool(options: CreateDockerSandboxToolsOptions): AnyTool {
  return createTool({
    name: "write_file",
    description: "Write a complete UTF-8 text file inside the sandbox workspace.",
    inputSchema: writeFileInput,
    outputSchema: writeFileOutput,
    execute: async ({ path, content }, context) => {
      const bytesWritten = new TextEncoder().encode(content).byteLength;
      const maxBytes = options.writeFile?.maxBytes;
      if (maxBytes !== undefined && bytesWritten > maxBytes) {
        throw toolPolicyError(`File content exceeds policy (${bytesWritten} > ${maxBytes}).`);
      }
      await options.sandbox.writeTextFile({
        path,
        text: content,
        ...(context.abortSignal === undefined ? {} : { abortSignal: context.abortSignal }),
      });
      return { path, bytesWritten };
    },
  });
}

function createListFilesTool(sandbox: DockerSandboxRuntime): AnyTool {
  return createTool({
    name: "list_files",
    description: "List direct children of a directory in the sandbox workspace.",
    inputSchema: listFilesInput,
    outputSchema: listFilesOutput,
    execute: async ({ path }, context) => ({
      path: path ?? ".",
      entries: [
        ...(await sandbox.listFiles({
          ...(path === undefined ? {} : { path }),
          ...(context.abortSignal === undefined ? {} : { abortSignal: context.abortSignal }),
        })),
      ],
    }),
  });
}

function createListPortsTool(sandbox: DockerSandboxRuntime): AnyTool {
  return createTool({
    name: "list_ports",
    description: "List explicitly published localhost TCP ports for the sandbox.",
    inputSchema: emptyInput,
    outputSchema: listPortsOutput,
    execute: async () => ({ ports: [...sandbox.publishedPorts] }),
  });
}

function createStartProcessTool(options: CreateDockerSandboxToolsOptions): AnyTool {
  return createTool({
    name: "start_process",
    description: "Start a managed long-running process inside the sandbox.",
    inputSchema: startProcessInput,
    outputSchema: processInfoOutput,
    execute: async ({ command, args, cwd, env }, context) => {
      assertCommandAllowed(command, options.exec?.commands);
      return serializeProcessInfo(
        await options.sandbox.startProcess({
          command,
          ...(args === undefined ? {} : { args }),
          ...(cwd === undefined ? {} : { cwd }),
          ...(env === undefined ? {} : { env }),
          ...(context.abortSignal === undefined ? {} : { abortSignal: context.abortSignal }),
        }),
      );
    },
  });
}

function createListProcessesTool(sandbox: DockerSandboxRuntime): AnyTool {
  return createTool({
    name: "list_processes",
    description: "List processes managed by this live sandbox handle.",
    inputSchema: emptyInput,
    outputSchema: listProcessesOutput,
    execute: async (_, context) => ({
      processes: (
        await sandbox.listProcesses(
          context.abortSignal === undefined ? {} : { abortSignal: context.abortSignal },
        )
      ).map(serializeProcessInfo),
    }),
  });
}

function createReadProcessLogsTool(options: CreateDockerSandboxToolsOptions): AnyTool {
  const maxLogBytes = options.process?.maxLogBytes ?? 64 * 1024;
  return createTool({
    name: "read_process_logs",
    description: "Read bounded UTF-8 output from a managed sandbox process.",
    inputSchema: readProcessLogsInput,
    outputSchema: processLogsOutput,
    execute: async ({ processId, tailBytes }, context) => {
      const effectiveTailBytes = tailBytes ?? maxLogBytes;
      if (effectiveTailBytes > maxLogBytes) {
        throw toolPolicyError(
          `Process log request exceeds policy (${effectiveTailBytes} > ${maxLogBytes}).`,
        );
      }
      const logs = await options.sandbox.readProcessLogs({
        processId,
        tailBytes: effectiveTailBytes,
        ...(context.abortSignal === undefined ? {} : { abortSignal: context.abortSignal }),
      });
      return {
        processId,
        stdout: decodeUtf8(logs.stdout),
        stderr: decodeUtf8(logs.stderr),
        stdoutTruncated: logs.stdoutTruncated,
        stderrTruncated: logs.stderrTruncated,
      };
    },
  });
}

function createStopProcessTool(options: CreateDockerSandboxToolsOptions): AnyTool {
  return createTool({
    name: "stop_process",
    description: "Stop a process managed by this live sandbox handle.",
    inputSchema: processIdInput,
    outputSchema: processInfoOutput,
    execute: async ({ processId }, context) =>
      serializeProcessInfo(
        await options.sandbox.stopProcess({
          processId,
          gracePeriodMs: options.process?.stopGracePeriodMs ?? 5_000,
          ...(context.abortSignal === undefined ? {} : { abortSignal: context.abortSignal }),
        }),
      ),
  });
}

function createWaitForPortTool(options: CreateDockerSandboxToolsOptions): AnyTool {
  return createTool({
    name: "wait_for_port",
    description: "Wait until an explicitly published sandbox TCP port is listening.",
    inputSchema: waitForPortInput,
    outputSchema: waitForPortOutput,
    execute: async ({ containerPort, timeoutMs }, context) => {
      const effectiveTimeoutMs = timeoutMs ?? options.process?.defaultWaitTimeoutMs ?? 30_000;
      const maxWaitTimeoutMs = options.process?.maxWaitTimeoutMs ?? maxToolTimeoutMs;
      if (effectiveTimeoutMs > maxWaitTimeoutMs) {
        throw toolPolicyError(
          `Port wait timeout exceeds policy (${effectiveTimeoutMs} > ${maxWaitTimeoutMs}).`,
        );
      }
      return {
        port: await options.sandbox.waitForPort({
          containerPort,
          timeoutMs: effectiveTimeoutMs,
          ...(context.abortSignal === undefined ? {} : { abortSignal: context.abortSignal }),
        }),
      };
    },
  });
}

function serializeExecResult(result: DockerSandboxExecResult) {
  const output = {
    status: result.status,
    stdout: decodeUtf8(result.stdout),
    stderr: decodeUtf8(result.stderr),
    durationMs: result.durationMs,
    stdoutTruncated: result.stdoutTruncated,
    stderrTruncated: result.stderrTruncated,
  };
  return result.status === "exited"
    ? { ...output, status: "exited" as const, exitCode: result.exitCode }
    : { ...output, status: "timed_out" as const };
}

function serializeProcessInfo(process: DockerSandboxProcessInfo) {
  return {
    id: process.id,
    command: process.command,
    args: [...process.args],
    status: process.status,
    startedAt: process.startedAt,
    ...(process.cwd === undefined ? {} : { cwd: process.cwd }),
    ...(process.exitCode === undefined ? {} : { exitCode: process.exitCode }),
    ...(process.endedAt === undefined ? {} : { endedAt: process.endedAt }),
  };
}

function validateFactoryOptions(options: CreateDockerSandboxToolsOptions): void {
  if (!isRecord(options)) {
    throw new TypeError("options must be an object.");
  }
  if (!isDockerSandboxRuntime(options.sandbox)) {
    throw new TypeError("sandbox must be a DockerSandboxRuntime.");
  }
  if (!Array.isArray(options.tools) || options.tools.length === 0) {
    throw new TypeError("tools must be a non-empty array.");
  }
  const known = new Set<string>(allToolNames);
  const seen = new Set<string>();
  for (const name of options.tools as readonly unknown[]) {
    if (typeof name !== "string" || !known.has(name)) {
      throw new TypeError("tools contains an unsupported sandbox tool name.");
    }
    if (seen.has(name)) throw new TypeError(`tools contains a duplicate: ${name}`);
    seen.add(name);
  }
  for (const [name, policy] of [
    ["exec", options.exec],
    ["readFile", options.readFile],
    ["writeFile", options.writeFile],
    ["process", options.process],
  ] as const) {
    if (policy !== undefined && !isRecord(policy)) {
      throw new TypeError(`${name} must be an object.`);
    }
  }
  validateCommandPolicy(options.exec?.commands);
  assertOptionalPositiveInteger(options.exec?.defaultTimeoutMs, "exec.defaultTimeoutMs");
  assertOptionalPositiveInteger(options.exec?.maxTimeoutMs, "exec.maxTimeoutMs");
  if (
    (options.exec?.defaultTimeoutMs ?? 0) > maxToolTimeoutMs ||
    (options.exec?.maxTimeoutMs ?? 0) > maxToolTimeoutMs
  ) {
    throw toolPolicyError(`Sandbox tool command timeouts cannot exceed ${maxToolTimeoutMs}.`);
  }
  if (
    options.exec?.defaultTimeoutMs !== undefined &&
    options.exec.maxTimeoutMs !== undefined &&
    options.exec.defaultTimeoutMs > options.exec.maxTimeoutMs
  ) {
    throw toolPolicyError("exec.defaultTimeoutMs cannot exceed exec.maxTimeoutMs.");
  }
  assertOptionalBoundedPositiveInteger(options.readFile?.maxBytes, "readFile.maxBytes");
  assertOptionalPositiveInteger(options.readFile?.defaultLineCount, "readFile.defaultLineCount");
  assertOptionalPositiveInteger(options.readFile?.maxLineCount, "readFile.maxLineCount");
  assertOptionalBoundedNonNegativeInteger(options.writeFile?.maxBytes, "writeFile.maxBytes");
  assertOptionalBoundedNonNegativeInteger(options.process?.maxLogBytes, "process.maxLogBytes");
  assertOptionalPositiveInteger(
    options.process?.defaultWaitTimeoutMs,
    "process.defaultWaitTimeoutMs",
  );
  assertOptionalPositiveInteger(options.process?.maxWaitTimeoutMs, "process.maxWaitTimeoutMs");
  assertOptionalNonNegativeInteger(options.process?.stopGracePeriodMs, "process.stopGracePeriodMs");
  const defaultWaitTimeoutMs = options.process?.defaultWaitTimeoutMs;
  const maxWaitTimeoutMs = options.process?.maxWaitTimeoutMs ?? maxToolTimeoutMs;
  if (maxWaitTimeoutMs > maxToolTimeoutMs) {
    throw toolPolicyError(`process.maxWaitTimeoutMs cannot exceed ${maxToolTimeoutMs}.`);
  }
  if (defaultWaitTimeoutMs !== undefined && defaultWaitTimeoutMs > maxWaitTimeoutMs) {
    throw toolPolicyError("process.defaultWaitTimeoutMs cannot exceed process.maxWaitTimeoutMs.");
  }
}

function snapshotFactoryOptions(
  options: CreateDockerSandboxToolsOptions,
): CreateDockerSandboxToolsOptions {
  const toolNames = Object.freeze([...options.tools]) as unknown as readonly [
    DockerSandboxToolName,
    ...DockerSandboxToolName[],
  ];
  const commands =
    options.exec?.commands === undefined
      ? undefined
      : Object.freeze({
          mode: options.exec.commands.mode,
          values: Object.freeze([...options.exec.commands.values]),
        });
  return Object.freeze({
    sandbox: options.sandbox,
    tools: toolNames,
    ...(options.exec === undefined
      ? {}
      : {
          exec: Object.freeze({
            ...options.exec,
            ...(commands === undefined ? {} : { commands }),
          }),
        }),
    ...(options.readFile === undefined ? {} : { readFile: Object.freeze({ ...options.readFile }) }),
    ...(options.writeFile === undefined
      ? {}
      : { writeFile: Object.freeze({ ...options.writeFile }) }),
    ...(options.process === undefined ? {} : { process: Object.freeze({ ...options.process }) }),
  });
}

function validateCommandPolicy(policy: DockerSandboxCommandPolicy | undefined): void {
  if (policy === undefined) return;
  if (!isRecord(policy)) throw toolPolicyError("exec.commands must be an object.");
  if (policy.mode !== "allow" && policy.mode !== "block") {
    throw toolPolicyError("exec.commands must use mode allow or block.");
  }
  if (!Array.isArray(policy.values))
    throw toolPolicyError("exec.commands.values must be an array.");
  const seen = new Set<string>();
  for (const value of policy.values as readonly unknown[]) {
    if (typeof value !== "string" || value.length === 0) {
      throw toolPolicyError("exec.commands.values must contain non-empty strings.");
    }
    if (seen.has(value))
      throw toolPolicyError(`exec.commands.values contains a duplicate: ${value}`);
    seen.add(value);
  }
}

function assertCommandAllowed(
  command: string,
  policy: DockerSandboxCommandPolicy | undefined,
): void {
  if (policy === undefined) return;
  const included = policy.values.includes(command);
  if ((policy.mode === "allow" && !included) || (policy.mode === "block" && included)) {
    throw toolPolicyError(`Command is rejected by sandbox tool policy: ${command}`);
  }
}

function assertTimeoutAllowed(timeoutMs: number | undefined, maxTimeoutMs: number | undefined) {
  if (timeoutMs !== undefined && maxTimeoutMs !== undefined && timeoutMs > maxTimeoutMs) {
    throw toolPolicyError(`Command timeout exceeds policy (${timeoutMs} > ${maxTimeoutMs}).`);
  }
}

function resolveReadFileLimits(options: CreateDockerSandboxToolsOptions) {
  const defaultLineCount = options.readFile?.defaultLineCount ?? defaultReadFileLineCount;
  const maxLineCount = options.readFile?.maxLineCount ?? defaultReadFileMaxLineCount;
  const maxBytes = options.readFile?.maxBytes ?? defaultReadFileMaxBytes;
  if (defaultLineCount > maxLineCount) {
    throw toolPolicyError("readFile.defaultLineCount cannot exceed readFile.maxLineCount.");
  }
  if (maxLineCount > maxToolReadFileLines) {
    throw toolPolicyError(`readFile.maxLineCount cannot exceed ${maxToolReadFileLines}.`);
  }
  return { defaultLineCount, maxLineCount, maxBytes };
}

function assertOptionalPositiveInteger(value: number | undefined, name: string): void {
  if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) {
    throw toolPolicyError(`${name} must be a positive safe integer.`);
  }
}

function assertOptionalNonNegativeInteger(value: number | undefined, name: string): void {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
    throw toolPolicyError(`${name} must be a non-negative safe integer.`);
  }
}

function assertOptionalBoundedNonNegativeInteger(value: number | undefined, name: string): void {
  assertOptionalNonNegativeInteger(value, name);
  if (value !== undefined && value > maxToolBytes) {
    throw toolPolicyError(`${name} cannot exceed ${maxToolBytes}.`);
  }
}

function assertOptionalBoundedPositiveInteger(value: number | undefined, name: string): void {
  assertOptionalPositiveInteger(value, name);
  if (value !== undefined && value > maxToolBytes) {
    throw toolPolicyError(`${name} cannot exceed ${maxToolBytes}.`);
  }
}

function isDockerSandboxRuntime(value: unknown): value is DockerSandboxRuntime {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    value.provider === "docker" &&
    typeof value.workdir === "string" &&
    Array.isArray(value.publishedPorts) &&
    [
      "exec",
      "execStream",
      "readFile",
      "readTextFile",
      "readTextFilePage",
      "writeFile",
      "writeTextFile",
      "listFiles",
      "startProcess",
      "listProcesses",
      "readProcessLogs",
      "stopProcess",
      "waitForPort",
    ].every((name) => typeof value[name] === "function")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toolPolicyError(message: string): DockerSandboxError {
  return new DockerSandboxError(message, "tool_policy");
}
