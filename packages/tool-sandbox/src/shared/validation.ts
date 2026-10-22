import { DockerSandboxError } from "../errors";
import { normalizeSandboxPath } from "../path";
import type {
  SandboxExecOptions,
  SandboxProcessStartOptions,
  SandboxReadFileOptions,
} from "../types";

export const defaultTextFilePageLines = 500;
export const defaultTextFilePageBytes = 64 * 1024;
export const defaultPortWaitTimeoutMs = 30_000;
export const defaultPortWaitIntervalMs = 100;
const envKeyPattern = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function assertOptionsObject(value: unknown): asserts value is Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError("options must be an object.");
}

export function assertNonEmptyString(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0)
    throw new TypeError(`${name} must be a non-empty string.`);
}

export function assertPositiveSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new RangeError(`${name} must be a positive safe integer.`);
}

export function assertNonNegativeSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new RangeError(`${name} must be a non-negative safe integer.`);
}

export function assertPort(port: number): void {
  if (!isPort(port))
    throw new DockerSandboxError(
      `Sandbox port must be an integer from 1 to 65535: ${port}`,
      "port",
    );
}

export function isPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65_535;
}

export function copyStringRecord(
  value: Readonly<Record<string, string>> | undefined,
  name: string,
): Record<string, string> {
  if (value === undefined) return {};
  if (!isRecord(value)) throw new TypeError(`${name} must be an object.`);
  const copy: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "string") throw new TypeError(`${name}.${key} must be a string.`);
    if (name === "env" && !envKeyPattern.test(key))
      throw new TypeError(`Invalid environment variable name: ${key}`);
    copy[key] = item;
  }
  return copy;
}

export function validateExecOptions(options: SandboxExecOptions): void {
  assertOptionsObject(options);
  assertNonEmptyString(options.command, "command");
  if (
    options.args !== undefined &&
    (!Array.isArray(options.args) || !options.args.every((value) => typeof value === "string"))
  ) {
    throw new TypeError("args must contain only strings.");
  }
  if (options.cwd !== undefined) normalizeSandboxPath(options.cwd, { allowRoot: true });
  copyStringRecord(options.env, "env");
  if (options.timeoutMs !== undefined) assertPositiveSafeInteger(options.timeoutMs, "timeoutMs");
  if (
    options.input !== undefined &&
    typeof options.input !== "string" &&
    !(options.input instanceof Uint8Array)
  ) {
    throw new TypeError("input must be a string or Uint8Array.");
  }
}

export function validateProcessStartOptions(options: SandboxProcessStartOptions): void {
  assertOptionsObject(options);
  assertNonEmptyString(options.command, "command");
  if (
    options.args !== undefined &&
    (!Array.isArray(options.args) || !options.args.every((value) => typeof value === "string"))
  ) {
    throw new TypeError("args must contain only strings.");
  }
  if (options.cwd !== undefined) normalizeSandboxPath(options.cwd, { allowRoot: true });
  copyStringRecord(options.env, "env");
}

export function assertReadOptions(options: SandboxReadFileOptions): void {
  assertOptionsObject(options);
  normalizeSandboxPath(options.path);
}

export function combineSignals(first: AbortSignal | undefined, second: AbortSignal): AbortSignal {
  return first === undefined ? second : AbortSignal.any([first, second]);
}

export async function waitWithSignal(timeoutMs: number, abortSignal: AbortSignal): Promise<void> {
  abortSignal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      abortSignal.removeEventListener("abort", abort);
      resolve();
    }, timeoutMs);
    const abort = () => {
      clearTimeout(timeout);
      reject(abortSignal.reason ?? new DOMException("Aborted", "AbortError"));
    };
    abortSignal.addEventListener("abort", abort, { once: true });
  });
}

/** Defaults and bounds shared by every runtime's readTextFilePage. */
export function resolveTextFilePageOptions(options: {
  startLine?: number;
  lineCount?: number;
  maxBytes?: number;
}): { startLine: number; lineCount: number; maxBytes: number } {
  const startLine = options.startLine ?? 1;
  const lineCount = options.lineCount ?? defaultTextFilePageLines;
  const maxBytes = options.maxBytes ?? defaultTextFilePageBytes;
  assertPositiveSafeInteger(startLine, "startLine");
  assertPositiveSafeInteger(lineCount, "lineCount");
  assertPositiveSafeInteger(maxBytes, "maxBytes");
  return { startLine, lineCount, maxBytes };
}

/** Validated waitForPort timing shared by every runtime. */
export function resolvePortWaitOptions(options: {
  containerPort: number;
  timeoutMs?: number;
  intervalMs?: number;
}): { timeoutMs: number; intervalMs: number } {
  assertPort(options.containerPort);
  const timeoutMs = options.timeoutMs ?? defaultPortWaitTimeoutMs;
  const intervalMs = options.intervalMs ?? defaultPortWaitIntervalMs;
  assertPositiveSafeInteger(timeoutMs, "timeoutMs");
  assertPositiveSafeInteger(intervalMs, "intervalMs");
  return { timeoutMs, intervalMs };
}
