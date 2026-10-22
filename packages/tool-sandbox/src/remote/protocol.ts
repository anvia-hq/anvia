import type WebSocket from "ws";
import { z } from "zod";
import { DockerSandboxError, dockerSandboxErrorCodes } from "../errors";
import type { SandboxExecOptions, SandboxExecResult, SandboxProcessLogs } from "../types";

/** Bump on any incompatible frame change. The hub rejects daemons that speak another version. */
export const PROTOCOL_VERSION = 1;

/** WebSocket close code the hub uses when a newer daemon connection takes over a sandbox. */
export const CLOSE_CODE_SUPERSEDED = 4001;

/**
 * Optional features a peer can advertise in `hello` (daemon) and `welcome` (hub). A peer that
 * predates a feature sends no `capabilities` at all, which reads as "none", so features can be
 * added without bumping {@link PROTOCOL_VERSION}.
 */
export const terminalCapability = "terminal";
/** Terminal sessions persist in tmux, so they survive a daemon restart. */
export const terminalTmuxCapability = "terminal.tmux";
const capabilities = z.array(z.string().max(64)).max(32).optional();

export const terminalSessionNamePattern = /^[A-Za-z0-9_-]{1,64}$/;
const terminalSessionName = z.string().regex(terminalSessionNamePattern);
const terminalSize = z.number().int().min(1).max(1_000);
const ptyId = z.string().min(1).max(128);

const requestId = z.string().min(1).max(128);
const base64 = z.string();
const nonNegativeInt = z.number().int().nonnegative();

const wireInput = z.union([z.object({ text: z.string() }), z.object({ base64 })]);

const execParams = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  cwd: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
  timeoutMs: z.number().int().positive().optional(),
  input: wireInput.optional(),
});
const pathParams = z.object({ path: z.string().min(1) });
const processStartParams = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  cwd: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
});

export const methodParams = {
  exec: execParams,
  execStream: execParams,
  readFile: pathParams,
  readTextFilePage: pathParams.extend({
    startLine: z.number().int().positive().optional(),
    lineCount: z.number().int().positive().optional(),
    maxBytes: z.number().int().positive().optional(),
  }),
  writeFile: pathParams.extend({ base64 }),
  listFiles: z.object({ path: z.string().min(1).optional() }),
  startProcess: processStartParams,
  listProcesses: z.object({}),
  readProcessLogs: z.object({
    processId: z.string().min(1),
    tailBytes: nonNegativeInt.optional(),
  }),
  stopProcess: z.object({ processId: z.string().min(1), gracePeriodMs: nonNegativeInt.optional() }),
  waitForPort: z.object({
    containerPort: z.number().int().min(1).max(65_535),
    timeoutMs: z.number().int().positive().optional(),
    intervalMs: z.number().int().positive().optional(),
  }),
  terminalList: z.object({}),
  terminalKill: z.object({ sessionName: terminalSessionName }),
} as const;

export type SandboxMethod = keyof typeof methodParams;
export type MethodParams<M extends SandboxMethod> = z.infer<(typeof methodParams)[M]>;

/** Methods that change sandbox state. Only these carry an operationId and are deduplicated. */
export const mutatingMethods: ReadonlySet<SandboxMethod> = new Set([
  "exec",
  "execStream",
  "writeFile",
  "startProcess",
  "stopProcess",
]);

const execBase = {
  stdout: base64,
  stderr: base64,
  durationMs: z.number().nonnegative(),
  stdoutTruncated: z.boolean(),
  stderrTruncated: z.boolean(),
};
const execResult = z.discriminatedUnion("status", [
  z.object({ status: z.literal("exited"), exitCode: z.number().int(), ...execBase }),
  z.object({ status: z.literal("timed_out"), ...execBase }),
]);
const processInfo = z.object({
  id: z.string(),
  command: z.string(),
  args: z.array(z.string()),
  cwd: z.string().optional(),
  status: z.enum(["running", "exited", "stopped"]),
  exitCode: z.number().int().optional(),
  startedAt: z.string(),
  endedAt: z.string().optional(),
});

export const methodResults = {
  exec: execResult,
  execStream: execResult,
  readFile: z.object({ base64 }),
  readTextFilePage: z.object({
    content: z.string(),
    startLine: z.number().int(),
    endLine: z.number().int().nullable(),
    nextStartLine: z.number().int().nullable(),
    truncated: z.boolean(),
    truncatedBy: z.enum(["lines", "bytes"]).nullable(),
  }),
  writeFile: z.object({}),
  listFiles: z.object({
    entries: z.array(
      z.object({
        path: z.string(),
        type: z.enum(["file", "directory", "symlink", "other"]),
        size: nonNegativeInt.optional(),
      }),
    ),
  }),
  startProcess: processInfo,
  listProcesses: z.object({ processes: z.array(processInfo) }),
  readProcessLogs: z.object({
    stdout: base64,
    stderr: base64,
    stdoutTruncated: z.boolean(),
    stderrTruncated: z.boolean(),
  }),
  stopProcess: processInfo,
  waitForPort: z.object({ containerPort: z.number().int(), protocol: z.literal("tcp") }),
  terminalList: z.object({
    sessions: z.array(
      z.object({
        name: z.string(),
        attached: nonNegativeInt,
        persistent: z.boolean(),
        createdAt: z.string().optional(),
      }),
    ),
  }),
  terminalKill: z.object({}),
} as const satisfies Record<SandboxMethod, z.ZodType>;

export type MethodResult<M extends SandboxMethod> = z.infer<(typeof methodResults)[M]>;

/** One terminal session, as `terminalList` reports it. */
export type TerminalSessionInfo = MethodResult<"terminalList">["sessions"][number];

/** A WebSocket message as text. Frames are JSON, so they are never binary. */
export function rawDataToString(data: WebSocket.RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  return Buffer.from(data).toString("utf8");
}

const operationId = z.string().min(1).max(256);

function request<M extends SandboxMethod>(method: M) {
  return z.object({
    type: z.literal("request"),
    requestId,
    operationId: operationId.optional(),
    method: z.literal(method),
    params: methodParams[method],
  });
}

const requestFrame = z.discriminatedUnion("method", [
  request("exec"),
  request("execStream"),
  request("readFile"),
  request("readTextFilePage"),
  request("writeFile"),
  request("listFiles"),
  request("startProcess"),
  request("listProcesses"),
  request("readProcessLogs"),
  request("stopProcess"),
  request("waitForPort"),
  request("terminalList"),
  request("terminalKill"),
]);

const ptyOpen = z.object({
  type: z.literal("pty.open"),
  ptyId,
  sessionName: terminalSessionName,
  cols: terminalSize,
  rows: terminalSize,
  cwd: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
  readOnly: z.boolean().optional(),
});
const ptyInput = z.object({ type: z.literal("pty.input"), ptyId, data: base64.max(131_072) });
const ptyResize = z.object({
  type: z.literal("pty.resize"),
  ptyId,
  cols: terminalSize,
  rows: terminalSize,
});
/** Cumulative bytes of `pty.output` the receiver has consumed. Drives flow control. */
const ptyAck = z.object({ type: z.literal("pty.ack"), ptyId, bytes: nonNegativeInt });
const ptyClose = z.object({ type: z.literal("pty.close"), ptyId });

export const ptyExitReasons = ["exited", "closed", "killed", "error", "disconnected"] as const;
export type PtyExitReason = (typeof ptyExitReasons)[number];

const ping = z.object({ type: z.literal("ping") });
const pong = z.object({ type: z.literal("pong") });

/** Frames the hub sends to a daemon. */
export const hubFrameSchema = z.union([
  requestFrame,
  z.object({ type: z.literal("cancel"), requestId }),
  ptyOpen,
  ptyInput,
  ptyResize,
  ptyAck,
  ptyClose,
  z.object({
    type: z.literal("welcome"),
    protocolVersion: z.number().int(),
    heartbeatIntervalMs: z.number().int().positive(),
    capabilities,
  }),
  ping,
  pong,
]);
export type HubFrame = z.infer<typeof hubFrameSchema>;
export type RequestFrame = z.infer<typeof requestFrame>;

/** Frames a daemon sends to the hub. */
export const daemonFrameSchema = z.union([
  z.object({
    type: z.literal("hello"),
    protocolVersion: z.number().int(),
    daemonVersion: z.string(),
    workdir: z.string(),
    capabilities,
  }),
  z.object({ type: z.literal("pty.opened"), ptyId }),
  z.object({
    type: z.literal("pty.output"),
    ptyId,
    seq: nonNegativeInt,
    data: base64,
  }),
  z.object({
    type: z.literal("pty.exit"),
    ptyId,
    reason: z.enum(ptyExitReasons),
    exitCode: z.number().int().optional(),
  }),
  z.object({ type: z.literal("response"), requestId, result: z.unknown() }),
  z.object({
    type: z.literal("error"),
    requestId: requestId.optional(),
    code: z.string(),
    message: z.string(),
    name: z.enum(["TypeError", "RangeError"]).optional(),
    details: z.unknown().optional(),
  }),
  z.object({
    type: z.literal("stream"),
    requestId,
    seq: nonNegativeInt,
    stream: z.enum(["stdout", "stderr"]),
    data: base64,
  }),
  ping,
  pong,
]);
export type DaemonFrame = z.infer<typeof daemonFrameSchema>;

// ---- byte and value codecs -------------------------------------------------------------------

export function encodeBytes(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
}

export function decodeBytes(data: string): Uint8Array {
  const bytes = Buffer.from(data, "base64");
  return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength).slice();
}

export function encodeInput(
  input: SandboxExecOptions["input"],
): z.infer<typeof wireInput> | undefined {
  if (input === undefined) return undefined;
  return typeof input === "string" ? { text: input } : { base64: encodeBytes(input) };
}

export function decodeInput(
  input: z.infer<typeof wireInput> | undefined,
): string | Uint8Array | undefined {
  if (input === undefined) return undefined;
  return "text" in input ? input.text : decodeBytes(input.base64);
}

export function encodeExecResult(result: SandboxExecResult): MethodResult<"exec"> {
  const common = {
    stdout: encodeBytes(result.stdout),
    stderr: encodeBytes(result.stderr),
    durationMs: result.durationMs,
    stdoutTruncated: result.stdoutTruncated,
    stderrTruncated: result.stderrTruncated,
  };
  return result.status === "exited"
    ? { ...common, status: "exited", exitCode: result.exitCode }
    : { ...common, status: "timed_out" };
}

export function decodeExecResult(result: MethodResult<"exec">): SandboxExecResult {
  const common = {
    stdout: decodeBytes(result.stdout),
    stderr: decodeBytes(result.stderr),
    durationMs: result.durationMs,
    stdoutTruncated: result.stdoutTruncated,
    stderrTruncated: result.stderrTruncated,
  };
  return result.status === "exited"
    ? { ...common, status: "exited", exitCode: result.exitCode }
    : { ...common, status: "timed_out" };
}

export function encodeProcessLogs(logs: SandboxProcessLogs): MethodResult<"readProcessLogs"> {
  return {
    stdout: encodeBytes(logs.stdout),
    stderr: encodeBytes(logs.stderr),
    stdoutTruncated: logs.stdoutTruncated,
    stderrTruncated: logs.stderrTruncated,
  };
}

export function decodeProcessLogs(logs: MethodResult<"readProcessLogs">): SandboxProcessLogs {
  return {
    stdout: decodeBytes(logs.stdout),
    stderr: decodeBytes(logs.stderr),
    stdoutTruncated: logs.stdoutTruncated,
    stderrTruncated: logs.stderrTruncated,
  };
}

/** Drop keys whose value is undefined, which `exactOptionalPropertyTypes` treats as absent. */
export type Compact<T> = { [K in keyof T]: Exclude<T[K], undefined> };

export function compact<T extends Record<string, unknown>>(value: T): Compact<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as Compact<T>;
}

// ---- errors ----------------------------------------------------------------------------------

const knownCodes: ReadonlySet<string> = new Set(dockerSandboxErrorCodes);

export type WireError = Extract<DaemonFrame, { type: "error" }>;

/** Describe a failure for the wire. Causes and stack traces never leave the sandbox. */
export function encodeError(error: unknown, requestIdValue?: string): WireError {
  const base: { type: "error"; requestId?: string } = { type: "error" };
  if (requestIdValue !== undefined) base.requestId = requestIdValue;
  if (error instanceof DockerSandboxError) {
    const details = jsonSafe(error.details);
    return compact({ ...base, code: error.code, message: error.message, details });
  }
  if (error instanceof TypeError)
    return { ...base, code: "protocol", message: error.message, name: "TypeError" };
  if (error instanceof RangeError)
    return { ...base, code: "protocol", message: error.message, name: "RangeError" };
  const message = error instanceof Error ? error.message : "Unexpected sandbox daemon failure.";
  return { ...base, code: "protocol", message };
}

export function decodeError(frame: WireError): Error {
  if (frame.name === "TypeError") return new TypeError(frame.message);
  if (frame.name === "RangeError") return new RangeError(frame.message);
  if (knownCodes.has(frame.code)) {
    return new DockerSandboxError(
      frame.message,
      frame.code as DockerSandboxError["code"],
      frame.details,
    );
  }
  return new DockerSandboxError(frame.message, "protocol", frame.details);
}

function jsonSafe(value: unknown): unknown {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return undefined;
  }
}
