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

/** Raw TCP tunnels to loopback ports inside the sandbox. */
export const tunnelCapability = "tunnel";
/** A virtual display with screenshots, input actions, a control lock, and a VNC server. */
export const desktopCapability = "desktop";

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

const desktopLength = z.number().int().min(1).max(16_384);
const desktopCoordinate = z.number().int().min(0).max(32_767);
const desktopHolder = z.string().min(1).max(128);
const desktopButton = z.enum(["left", "middle", "right"]);
/** Key names as xdotool takes them: `Return`, `ctrl+c`, `alt+Tab`, `F5`. No shell syntax. */
export const desktopKeyPattern = /^[A-Za-z0-9_+\- ]{1,200}$/;

/** An input the agent performs. Coordinates are pixels of the current display. */
export const desktopActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("mouse_move"), x: desktopCoordinate, y: desktopCoordinate }),
  z.object({
    type: z.literal("click"),
    x: desktopCoordinate.optional(),
    y: desktopCoordinate.optional(),
    button: desktopButton.optional(),
    count: z.number().int().min(1).max(3).optional(),
  }),
  z.object({
    type: z.literal("drag"),
    fromX: desktopCoordinate.optional(),
    fromY: desktopCoordinate.optional(),
    toX: desktopCoordinate,
    toY: desktopCoordinate,
    button: desktopButton.optional(),
  }),
  z.object({
    type: z.literal("scroll"),
    x: desktopCoordinate.optional(),
    y: desktopCoordinate.optional(),
    direction: z.enum(["up", "down", "left", "right"]),
    amount: z.number().int().min(1).max(100).optional(),
  }),
  z.object({
    type: z.literal("type"),
    text: z.string().min(1).max(20_000),
    delayMs: z.number().int().min(0).max(1_000).optional(),
  }),
  z.object({ type: z.literal("key"), keys: z.string().regex(desktopKeyPattern) }),
]);
export type DesktopAction = z.infer<typeof desktopActionSchema>;

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
  desktopStatus: z.object({ start: z.boolean().optional() }),
  desktopResize: z.object({ width: desktopLength, height: desktopLength }),
  desktopScreenshot: z.object({ scale: z.number().gt(0).max(1).optional() }),
  desktopCursor: z.object({}),
  desktopAction: z.object({ action: desktopActionSchema }),
  desktopControl: z.object({}),
  desktopTakeover: z.object({
    holder: desktopHolder,
    leaseMs: z.number().int().positive().optional(),
  }),
  desktopRelease: z.object({ holder: desktopHolder.optional(), force: z.boolean().optional() }),
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
  "desktopAction",
  "desktopResize",
  "desktopTakeover",
  "desktopRelease",
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

export const desktopStates = ["stopped", "starting", "running", "restarting", "failed"] as const;
export type DesktopState = (typeof desktopStates)[number];

/** Who may drive the desktop. While a human holds it, the agent's inputs fail. */
const desktopControlResult = z.object({
  held: z.boolean(),
  holder: z.string().optional(),
  /** When the hold lapses unless renewed, as an ISO timestamp. */
  expiresAt: z.string().optional(),
});
export type DesktopControl = z.infer<typeof desktopControlResult>;

const desktopStatusResult = z.object({
  state: z.enum(desktopStates),
  width: z.number().int(),
  height: z.number().int(),
  maxWidth: z.number().int(),
  maxHeight: z.number().int(),
  display: z.string(),
  /** Loopback port of the VNC server. Reach it through a tunnel. */
  vncPort: z.number().int(),
  /** Times a crashed desktop process was restarted. */
  restarts: z.number().int(),
  message: z.string().optional(),
  control: desktopControlResult,
});
export type DesktopStatus = z.infer<typeof desktopStatusResult>;

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
  desktopStatus: desktopStatusResult,
  desktopResize: desktopStatusResult,
  desktopScreenshot: z.object({
    base64,
    /** Size of the image. Smaller than the display when a scale was asked for. */
    width: z.number().int(),
    height: z.number().int(),
    displayWidth: z.number().int(),
    displayHeight: z.number().int(),
  }),
  desktopCursor: z.object({ x: z.number().int(), y: z.number().int() }),
  desktopAction: z.object({}),
  desktopControl: desktopControlResult,
  desktopTakeover: desktopControlResult,
  desktopRelease: desktopControlResult,
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
  request("desktopStatus"),
  request("desktopResize"),
  request("desktopScreenshot"),
  request("desktopCursor"),
  request("desktopAction"),
  request("desktopControl"),
  request("desktopTakeover"),
  request("desktopRelease"),
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

const tunnelId = z.string().min(1).max(128);
/** The only addresses a tunnel may reach: the sandbox's own loopback. */
export const tunnelHosts = ["127.0.0.1", "::1"] as const;

const tunnelOpen = z.object({
  type: z.literal("tunnel.open"),
  tunnelId,
  port: z.number().int().min(1).max(65_535),
  /** Omit to try 127.0.0.1 and then ::1. */
  host: z.enum(tunnelHosts).optional(),
  /**
   * A named flow-control profile the hub is ready for, such as `interactive`. A daemon that does
   * not know the name, or predates profiles, uses its defaults, which every hub copes with.
   */
  profile: z.string().max(32).optional(),
});
const tunnelData = z.object({
  type: z.literal("tunnel.data"),
  tunnelId,
  data: base64.max(131_072),
});
/** Cumulative bytes of `tunnel.data` the receiver has consumed. Flow control, in both directions. */
const tunnelAck = z.object({ type: z.literal("tunnel.ack"), tunnelId, bytes: nonNegativeInt });
const tunnelClose = z.object({ type: z.literal("tunnel.close"), tunnelId });

export const tunnelCloseReasons = ["remote", "closed", "error", "disconnected"] as const;
export type TunnelCloseReason = (typeof tunnelCloseReasons)[number];

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
  tunnelOpen,
  tunnelData,
  tunnelAck,
  tunnelClose,
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
  z.object({ type: z.literal("tunnel.opened"), tunnelId }),
  z.object({
    type: z.literal("tunnel.data"),
    tunnelId,
    seq: nonNegativeInt,
    data: base64,
  }),
  tunnelAck,
  z.object({
    type: z.literal("tunnel.close"),
    tunnelId,
    reason: z.enum(tunnelCloseReasons),
    message: z.string().max(1_000).optional(),
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
