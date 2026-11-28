import {
  type AnyTool,
  createTool,
  createToolkit,
  type Toolkit,
  type ToolkitOptions,
} from "@anvia/core/tool";
import { z } from "zod";
import { decodeUtf8 } from "./docker-cli";
import { DockerSandboxError } from "./errors";
import { normalizeSandboxPath } from "./path";
import { sandboxShell } from "./shell";
import { attachSandboxStudioMetadata } from "./studio-metadata";
import type {
  CreateDockerSandboxToolsOptions,
  CreateSandboxToolsOptions,
  DockerSandbox,
  DockerSandboxCommandPolicy,
  DockerSandboxExecOptions,
  DockerSandboxExecResult,
  DockerSandboxListProcessesOptions,
  DockerSandboxProcessInfo,
  DockerSandboxToolName,
  SandboxRuntime,
  SandboxToolName,
  SandboxToolkitOptions,
} from "./types";
import { Writable } from "./internal/type-utils";
import { shellInterpreters } from "./types";

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

/**
 * Recovery classification for `@anvia/durable`'s `toolRecovery` option. Read-only tools are `safe`
 * to repeat; mutating tools carry `ToolCallContext.operationId` to the runtime so they are
 * `idempotent` on runtimes that deduplicate by `operationId` (such as `RemoteSandboxRuntime`).
 */
export const sandboxToolRecovery: Readonly<Record<SandboxToolName, "safe" | "idempotent">> =
  Object.freeze({
    exec_command: "idempotent",
    read_file: "safe",
    write_file: "idempotent",
    list_files: "safe",
    list_ports: "safe",
    start_process: "idempotent",
    list_processes: "safe",
    read_process_logs: "safe",
    stop_process: "idempotent",
    wait_for_port: "safe",
  });

type ResolvedSandboxToolsOptions = Omit<CreateSandboxToolsOptions, "sandbox" | "tools"> &
  Readonly<{
    sandbox: SandboxRuntime;
    tools: readonly [SandboxToolName, ...SandboxToolName[]];
  }>;

const execCommandInput = z.object({
  command: z
    .string()
    .min(1)
    .describe(
      "Command to run. Natural command lines use /bin/bash -c when available, otherwise sh -c. Use args for exact argv execution.",
    ),
  args: z
    .array(z.string())
    .describe("Optional exact arguments. Omit when command contains the complete command line.")
    .optional(),
  cwd: z
    .string()
    .describe("Workspace-relative directory or an absolute directory inside the sandbox workdir.")
    .optional(),
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
  path: z
    .string()
    .min(1)
    .describe("Workspace-relative path or an absolute path inside the sandbox workdir."),
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
  path: z
    .string()
    .min(1)
    .describe("Workspace-relative path or an absolute path inside the sandbox workdir."),
  content: z.string(),
});

const writeFileOutput = z.object({
  path: z.string(),
  bytesWritten: z.number().int().nonnegative(),
});

const listFilesInput = z.object({
  path: z
    .string()
    .describe("Workspace-relative directory or an absolute directory inside the sandbox workdir.")
    .optional(),
});
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
  command: execCommandInput.shape.command,
  args: execCommandInput.shape.args,
  cwd: z
    .string()
    .describe("Workspace-relative directory or an absolute directory inside the sandbox workdir.")
    .optional(),
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
const waitForPortOutput = z.object({
  port: publishedPortOutput.extend({
    host: z.string().optional(),
    hostPort: publishedPortOutput.shape.hostPort.optional(),
  }),
});

const defaultReadFileLineCount = 500;
const defaultReadFileMaxLineCount = 2_000;
const defaultReadFileMaxBytes = 64 * 1024;
const maxToolReadFileLines = 10_000;
const maxToolBytes = 1024 * 1024;
const maxToolTimeoutMs = 300_000;

export function createDockerSandboxTools(
  options: CreateDockerSandboxToolsOptions,
): readonly AnyTool[] {
  return createSandboxTools(options);
}

const defaultSandboxInstructions =
  "Use the sandbox tools to inspect files, run commands, and manage background processes inside the isolated workspace.";

/**
 * Creates an `@anvia/core` `Toolkit` backed by a local `DockerSandbox` or remote `SandboxRuntime`.
 * Supports standard `ToolkitOptions` (`include`, `exclude`, `prefix`, `requiresApproval`,
 * `timeoutMs`, `instructions`) and attaches Studio discovery metadata automatically.
 */
export function sandboxToolkit(options: SandboxToolkitOptions): Toolkit {
  if (typeof options !== "object" || options === null || Array.isArray(options)) {
    throw new TypeError("sandboxToolkit options must be an object.");
  }

  const toolOptions: Writable<CreateSandboxToolsOptions> = {
    sandbox: options.sandbox,
  };

  if (options.exec !== undefined) toolOptions.exec = options.exec;

  if (options.readFile !== undefined) toolOptions.readFile = options.readFile;

  if (options.writeFile !== undefined) toolOptions.writeFile = options.writeFile;

  if (options.process !== undefined) toolOptions.process = options.process;

  if (options.studio !== undefined) toolOptions.studio = options.studio;

  const tools = createSandboxTools(toolOptions);
  const toolkitOptions: ToolkitOptions<SandboxToolName> = {};

  if (options.include !== undefined) toolkitOptions.include = options.include;

  if (options.exclude !== undefined) toolkitOptions.exclude = options.exclude;

  if (options.prefix !== undefined) toolkitOptions.prefix = options.prefix;

  if (options.requiresApproval !== undefined) {
    toolkitOptions.requiresApproval = options.requiresApproval;
  }

  if (options.timeoutMs !== undefined) toolkitOptions.timeoutMs = options.timeoutMs;

  if (options.instructions !== undefined) toolkitOptions.instructions = options.instructions;

  return createToolkit(
    {
      name: "sandbox",
      tools,
      instructions: defaultSandboxInstructions,
    },
    toolkitOptions,
  );
}

export function createSandboxTools(options: CreateSandboxToolsOptions): readonly AnyTool[] {
  const runtime = validateFactoryOptions(options);
  const resolved = snapshotFactoryOptions(options, runtime);
  const selected = new Set(resolved.tools);
  const tools: AnyTool[] = [];

  for (const name of resolved.tools) {
    if (name === "exec_command") tools.push(createExecCommandTool(resolved));
    else if (name === "read_file") tools.push(createReadFileTool(resolved));
    else if (name === "write_file") tools.push(createWriteFileTool(resolved));
    else if (name === "list_files") tools.push(createListFilesTool(resolved.sandbox));
    else if (name === "list_ports") tools.push(createListPortsTool(resolved.sandbox));
    else if (name === "start_process") tools.push(createStartProcessTool(resolved));
    else if (name === "list_processes") tools.push(createListProcessesTool(resolved.sandbox));
    else if (name === "read_process_logs") tools.push(createReadProcessLogsTool(resolved));
    else if (name === "stop_process") tools.push(createStopProcessTool(resolved));
    else if (name === "wait_for_port") tools.push(createWaitForPortTool(resolved));
  }

  if (tools.length !== selected.size) {
    throw toolPolicyError("Sandbox tool selection contains an unsupported tool name.");
  }

  attachSandboxStudioMetadata(tools, options.sandbox, options.studio);

  return Object.freeze(tools);
}

function createExecCommandTool(options: ResolvedSandboxToolsOptions): AnyTool {
  return createTool({
    name: "exec_command",
    description:
      "Run a command inside the sandbox. Natural command lines use /bin/bash -c when available, otherwise sh -c; supply args for exact argv execution.",
    inputSchema: execCommandInput,
    outputSchema: execResultOutput,
    execute: async ({ command, args, cwd, env, timeoutMs, input }, context) => {
      const effectiveTimeoutMs = timeoutMs ?? options.exec?.defaultTimeoutMs;
      assertTimeoutAllowed(effectiveTimeoutMs, options.exec?.maxTimeoutMs);
      const normalizedCwd =
        cwd === undefined ? undefined : normalizeToolPath(options.sandbox, cwd, true);
      const invocation = await resolveExecInvocation(options, command, args, context.abortSignal);
      let execOptions: DockerSandboxExecOptions = {
        command: invocation.command,
      };

      if (invocation.args !== undefined) execOptions = { ...execOptions, args: invocation.args };

      if (normalizedCwd !== undefined) {
        execOptions = { ...execOptions, cwd: normalizedCwd };
      }

      if (env !== undefined) execOptions = { ...execOptions, env };

      if (effectiveTimeoutMs !== undefined) {
        execOptions = { ...execOptions, timeoutMs: effectiveTimeoutMs };
      }

      if (input !== undefined) execOptions = { ...execOptions, input };

      if (context.operationId !== undefined) {
        execOptions = { ...execOptions, operationId: context.operationId };
      }

      if (context.abortSignal !== undefined) {
        execOptions = { ...execOptions, abortSignal: context.abortSignal };
      }

      return serializeExecResult(await options.sandbox.exec(execOptions));
    },
  });
}

function createReadFileTool(options: ResolvedSandboxToolsOptions): AnyTool {
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

      let readOptions: Parameters<typeof options.sandbox.readTextFilePage>[0] = {
        path: normalizeToolPath(options.sandbox, path),
        startLine: startLine ?? 1,
        lineCount: effectiveLineCount,
        maxBytes: limits.maxBytes,
      };

      if (context.abortSignal !== undefined) {
        readOptions = { ...readOptions, abortSignal: context.abortSignal };
      }

      return options.sandbox.readTextFilePage(readOptions);
    },
  });
}

function createWriteFileTool(options: ResolvedSandboxToolsOptions): AnyTool {
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

      const normalizedPath = normalizeToolPath(options.sandbox, path);
      let writeOptions: Parameters<typeof options.sandbox.writeTextFile>[0] = {
        path: normalizedPath,
        text: content,
      };

      if (context.operationId !== undefined) {
        writeOptions = { ...writeOptions, operationId: context.operationId };
      }

      if (context.abortSignal !== undefined) {
        writeOptions = { ...writeOptions, abortSignal: context.abortSignal };
      }

      await options.sandbox.writeTextFile(writeOptions);
      return { path: normalizedPath, bytesWritten };
    },
  });
}

function createListFilesTool(sandbox: SandboxRuntime): AnyTool {
  return createTool({
    name: "list_files",
    description: "List direct children of a directory in the sandbox workspace.",
    inputSchema: listFilesInput,
    outputSchema: listFilesOutput,
    execute: async ({ path }, context) => {
      const normalizedPath = path === undefined ? "." : normalizeToolPath(sandbox, path, true);
      let listOptions: Parameters<typeof sandbox.listFiles>[0] = {};

      if (path !== undefined) listOptions = { ...listOptions, path: normalizedPath };

      if (context.abortSignal !== undefined) {
        listOptions = { ...listOptions, abortSignal: context.abortSignal };
      }

      return { path: normalizedPath, entries: [...(await sandbox.listFiles(listOptions))] };
    },
  });
}

function createListPortsTool(sandbox: SandboxRuntime): AnyTool {
  return createTool({
    name: "list_ports",
    description: "List explicitly published localhost TCP ports for the sandbox.",
    inputSchema: emptyInput,
    outputSchema: listPortsOutput,
    execute: async () => ({ ports: [...sandbox.publishedPorts] }),
  });
}

function createStartProcessTool(options: ResolvedSandboxToolsOptions): AnyTool {
  return createTool({
    name: "start_process",
    description:
      "Start a managed long-running process inside the sandbox. Natural command lines use /bin/bash -c when available, otherwise sh -c; supply args for exact argv execution.",
    inputSchema: startProcessInput,
    outputSchema: processInfoOutput,
    execute: async ({ command, args, cwd, env }, context) => {
      const normalizedCwd =
        cwd === undefined ? undefined : normalizeToolPath(options.sandbox, cwd, true);
      const invocation = await resolveExecInvocation(options, command, args, context.abortSignal);
      let startOptions: Parameters<typeof options.sandbox.startProcess>[0] = { ...invocation };

      if (normalizedCwd !== undefined) {
        startOptions = { ...startOptions, cwd: normalizedCwd };
      }

      if (env !== undefined) startOptions = { ...startOptions, env };

      if (context.operationId !== undefined) {
        startOptions = { ...startOptions, operationId: context.operationId };
      }

      if (context.abortSignal !== undefined) {
        startOptions = { ...startOptions, abortSignal: context.abortSignal };
      }

      return serializeProcessInfo(await options.sandbox.startProcess(startOptions));
    },
  });
}

function createListProcessesTool(sandbox: SandboxRuntime): AnyTool {
  return createTool({
    name: "list_processes",
    description: "List processes managed by this live sandbox handle.",
    inputSchema: emptyInput,
    outputSchema: listProcessesOutput,
    execute: async (_, context) => {
      const listOptions: Writable<DockerSandboxListProcessesOptions> = {};

      if (context.abortSignal !== undefined) listOptions.abortSignal = context.abortSignal;

      return {
        processes: (await sandbox.listProcesses(listOptions)).map(serializeProcessInfo),
      };
    },
  });
}

function createReadProcessLogsTool(options: ResolvedSandboxToolsOptions): AnyTool {
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

      let readOptions: Parameters<typeof options.sandbox.readProcessLogs>[0] = {
        processId,
        tailBytes: effectiveTailBytes,
      };

      if (context.abortSignal !== undefined) {
        readOptions = { ...readOptions, abortSignal: context.abortSignal };
      }

      const logs = await options.sandbox.readProcessLogs(readOptions);
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

function createStopProcessTool(options: ResolvedSandboxToolsOptions): AnyTool {
  return createTool({
    name: "stop_process",
    description: "Stop a process managed by this live sandbox handle.",
    inputSchema: processIdInput,
    outputSchema: processInfoOutput,
    execute: async ({ processId }, context) => {
      let stopOptions: Parameters<typeof options.sandbox.stopProcess>[0] = {
        processId,
        gracePeriodMs: options.process?.stopGracePeriodMs ?? 5_000,
      };

      if (context.operationId !== undefined) {
        stopOptions = { ...stopOptions, operationId: context.operationId };
      }

      if (context.abortSignal !== undefined) {
        stopOptions = { ...stopOptions, abortSignal: context.abortSignal };
      }

      return serializeProcessInfo(await options.sandbox.stopProcess(stopOptions));
    },
  });
}

function createWaitForPortTool(options: ResolvedSandboxToolsOptions): AnyTool {
  return createTool({
    name: "wait_for_port",
    description:
      options.sandbox.provider === "docker"
        ? "Wait until an explicitly published sandbox TCP port is listening."
        : "Wait until a TCP port is listening inside the sandbox.",
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

      let waitOptions: Parameters<typeof options.sandbox.waitForPort>[0] = {
        containerPort,
        timeoutMs: effectiveTimeoutMs,
      };

      if (context.abortSignal !== undefined) {
        waitOptions = { ...waitOptions, abortSignal: context.abortSignal };
      }

      return { port: await options.sandbox.waitForPort(waitOptions) };
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

function serializeProcessInfo(
  process: DockerSandboxProcessInfo,
): z.infer<typeof processInfoOutput> {
  let serialized: z.infer<typeof processInfoOutput> = {
    id: process.id,
    command: process.command,
    args: [...process.args],
    status: process.status,
    startedAt: process.startedAt,
  };

  if (process.cwd !== undefined) serialized = { ...serialized, cwd: process.cwd };

  if (process.exitCode !== undefined) serialized = { ...serialized, exitCode: process.exitCode };

  if (process.endedAt !== undefined) serialized = { ...serialized, endedAt: process.endedAt };

  return serialized;
}

function normalizeToolPath(sandbox: SandboxRuntime, input: string, allowRoot = false): string {
  return normalizeSandboxPath(input, { allowRoot, workdir: sandbox.workdir });
}

function validateFactoryOptions(options: CreateSandboxToolsOptions): SandboxRuntime {
  if (!isRecord(options)) {
    throw new TypeError("options must be an object.");
  }

  const runtime = resolveSandboxRuntime(options.sandbox);

  if (runtime === undefined) {
    throw new TypeError("sandbox must be a SandboxRuntime or DockerSandbox.");
  }

  if (options.tools !== undefined) {
    if (!Array.isArray(options.tools) || options.tools.length === 0) {
      throw new TypeError("tools must be a non-empty array.");
    }

    const known = new Set<string>(allToolNames);
    const seen = new Set<string>();
    for (const name of options.tools as readonly unknown[]) {
      if (typeof name !== "string" || !known.has(name)) {
        throw new TypeError(
          `tools contains an unsupported sandbox tool name: ${String(name)}. Expected one of: ${allToolNames.join(", ")}.`,
        );
      }

      if (seen.has(name)) throw new TypeError(`tools contains a duplicate: ${name}`);

      seen.add(name);
    }
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

  return runtime;
}

function snapshotCommandPolicy(policy: DockerSandboxCommandPolicy): DockerSandboxCommandPolicy {
  const values = Object.freeze([...policy.values]);

  if (policy.mode === "allow" && policy.allowShellInterpreters !== undefined) {
    return Object.freeze({
      mode: policy.mode,
      values,
      allowShellInterpreters: policy.allowShellInterpreters,
    });
  }

  return Object.freeze({ mode: policy.mode, values });
}

function snapshotFactoryOptions(
  options: CreateSandboxToolsOptions,
  runtime: SandboxRuntime,
): ResolvedSandboxToolsOptions {
  const toolNames = Object.freeze([...(options.tools ?? allToolNames)]) as unknown as readonly [
    DockerSandboxToolName,
    ...DockerSandboxToolName[],
  ];
  const commands =
    options.exec?.commands === undefined
      ? undefined
      : Object.freeze(snapshotCommandPolicy(options.exec.commands));
  let snapshot: ResolvedSandboxToolsOptions = {
    sandbox: runtime,
    tools: toolNames,
  };

  if (options.exec !== undefined) {
    let exec = { ...options.exec };

    if (commands !== undefined) exec = { ...exec, commands };

    snapshot = { ...snapshot, exec: Object.freeze(exec) };
  }

  if (options.readFile !== undefined) {
    snapshot = { ...snapshot, readFile: Object.freeze({ ...options.readFile }) };
  }

  if (options.writeFile !== undefined) {
    snapshot = { ...snapshot, writeFile: Object.freeze({ ...options.writeFile }) };
  }

  if (options.process !== undefined) {
    snapshot = { ...snapshot, process: Object.freeze({ ...options.process }) };
  }

  return Object.freeze(snapshot);
}

function validateCommandPolicy(policy: DockerSandboxCommandPolicy | undefined): void {
  if (policy === undefined) return;

  if (!isRecord(policy)) throw toolPolicyError("exec.commands must be an object.");

  if (policy.mode !== "allow" && policy.mode !== "block") {
    throw toolPolicyError("exec.commands must use mode allow or block.");
  }

  if (
    policy.mode === "allow" &&
    policy.allowShellInterpreters !== undefined &&
    typeof policy.allowShellInterpreters !== "boolean"
  ) {
    throw toolPolicyError("exec.commands.allowShellInterpreters must be a boolean.");
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

  if (policy.mode === "allow" && policy.allowShellInterpreters !== true) {
    const commandBasename = command.split("/").pop() ?? command;

    if (shellInterpreters.includes(commandBasename as (typeof shellInterpreters)[number])) {
      throw toolPolicyError(
        `Command is rejected by sandbox tool policy: ${command} (shell interpreter not allowed)`,
      );
    }
  }
}

async function resolveExecInvocation(
  options: ResolvedSandboxToolsOptions,
  command: string,
  args: readonly string[] | undefined,
  abortSignal?: AbortSignal,
): Promise<Pick<DockerSandboxExecOptions, "command" | "args">> {
  abortSignal?.throwIfAborted();
  const policy = options.exec?.commands;

  if (args === undefined && requiresShell(command)) {
    if (policy?.mode === "block") {
      throw toolPolicyError(
        "Natural command lines cannot be used with block-mode command policies. Use command and args instead.",
      );
    }

    if (policy?.mode === "allow" && policy.allowShellInterpreters !== true) {
      throw toolPolicyError("Natural command lines require allowShellInterpreters: true.");
    }

    const shell = await sandboxShell(options.sandbox, abortSignal);
    abortSignal?.throwIfAborted();

    if (policy?.mode === "allow" && shell === "/bin/bash" && !policy.values.includes(shell)) {
      throw toolPolicyError(
        'Command is rejected by sandbox tool policy: /bin/bash (auto-selected for natural command lines; allow "/bin/bash" with allowShellInterpreters: true, or pass explicit command and args).',
      );
    }

    assertCommandAllowed(shell, policy);
    return { command: shell, args: ["-c", command] };
  }

  assertCommandAllowed(command, policy);
  return args === undefined ? { command } : { command, args };
}

function requiresShell(command: string): boolean {
  return /[\s|&;<>()$`'"*?[\]{}!#~=]/u.test(command);
}

function assertTimeoutAllowed(timeoutMs: number | undefined, maxTimeoutMs: number | undefined) {
  if (timeoutMs !== undefined && maxTimeoutMs !== undefined && timeoutMs > maxTimeoutMs) {
    throw toolPolicyError(`Command timeout exceeds policy (${timeoutMs} > ${maxTimeoutMs}).`);
  }
}

function resolveReadFileLimits(options: ResolvedSandboxToolsOptions) {
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

function resolveSandboxRuntime(
  value: SandboxRuntime | DockerSandbox | unknown,
): SandboxRuntime | undefined {
  if (isSandboxRuntime(value)) return value;

  if (isRecord(value) && isSandboxRuntime(value.runtime)) return value.runtime;

  return undefined;
}

function isSandboxRuntime(value: unknown): value is SandboxRuntime {
  if (!isRecord(value)) return false;

  return (
    typeof value.id === "string" &&
    typeof value.provider === "string" &&
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
