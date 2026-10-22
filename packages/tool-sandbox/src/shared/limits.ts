import { DockerSandboxError } from "../errors";
import type { SandboxRuntimeLimits } from "../types";
import { assertNonNegativeSafeInteger, assertPositiveSafeInteger, isRecord } from "./validation";

export const defaultCommandTimeoutMs = 30_000;
export const defaultMaxOutputBytes = 1024 * 1024;
export const defaultMaxFileBytes = 10 * 1024 * 1024;
export const defaultMaxProcesses = 4;

export type ResolvedRuntimeLimits = Required<SandboxRuntimeLimits>;

export function validateRuntimeLimits(runtime?: SandboxRuntimeLimits): void {
  if (runtime !== undefined && !isRecord(runtime)) {
    throw new TypeError("runtime must be an object.");
  }
  if (runtime?.commandTimeoutMs !== undefined)
    assertPositiveSafeInteger(runtime.commandTimeoutMs, "commandTimeoutMs");
  if (runtime?.maxOutputBytes !== undefined)
    assertNonNegativeSafeInteger(runtime.maxOutputBytes, "maxOutputBytes");
  if (runtime?.maxFileBytes !== undefined)
    assertNonNegativeSafeInteger(runtime.maxFileBytes, "maxFileBytes");
  if (runtime?.maxProcesses !== undefined)
    assertNonNegativeSafeInteger(runtime.maxProcesses, "maxProcesses");
}

export function resolveRuntimeLimits(runtime?: SandboxRuntimeLimits): ResolvedRuntimeLimits {
  return {
    commandTimeoutMs: runtime?.commandTimeoutMs ?? defaultCommandTimeoutMs,
    maxOutputBytes: runtime?.maxOutputBytes ?? defaultMaxOutputBytes,
    maxFileBytes: runtime?.maxFileBytes ?? defaultMaxFileBytes,
    maxProcesses: runtime?.maxProcesses ?? defaultMaxProcesses,
  };
}

export function assertFileSize(size: number, filePath: string, maxFileBytes: number): void {
  if (size > maxFileBytes) {
    throw new DockerSandboxError(
      `Sandbox file exceeds maxFileBytes (${size} > ${maxFileBytes}): ${filePath}`,
      "file_too_large",
    );
  }
}
