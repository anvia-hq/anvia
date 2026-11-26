import { DockerSandboxError } from "../errors";
import type { CommandResult } from "./run-command";
import { decodeUtf8 } from "./output";
import type { SandboxExecResult, SandboxExecTextResult, SandboxFileType } from "../types";

export function toExecResult(result: CommandResult): SandboxExecResult {
  const common = {
    stdout: result.stdout.slice(),
    stderr: result.stderr.slice(),
    durationMs: result.durationMs,
    stdoutTruncated: result.stdoutTruncated,
    stderrTruncated: result.stderrTruncated,
  };
  return result.timedOut
    ? { ...common, status: "timed_out" }
    : { ...common, status: "exited", exitCode: result.exitCode };
}

export function toExecTextResult(result: SandboxExecResult): SandboxExecTextResult {
  const common = {
    stdout: decodeUtf8(result.stdout),
    stderr: decodeUtf8(result.stderr),
    durationMs: result.durationMs,
    stdoutTruncated: result.stdoutTruncated,
    stderrTruncated: result.stderrTruncated,
  };
  return result.status === "exited"
    ? { ...common, status: "exited", exitCode: result.exitCode }
    : { ...common, status: "timed_out" };
}

const dockerDaemonUnavailablePatterns = [
  "cannot connect to the docker daemon",
  "is the docker daemon running",
  "failed to connect to the docker api",
  "error during connect",
  "permission denied while trying to connect to the docker daemon",
] as const;

export function isDockerDaemonUnavailable(stderr: string): boolean {
  const lower = stderr.toLowerCase();
  return dockerDaemonUnavailablePatterns.some((pattern) => lower.includes(pattern));
}

export function safeDecodeBytes(bytes: Uint8Array): string {
  try {
    return decodeUtf8(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

export function formatDockerFailure(
  prefix: string,
  result: { stdout: Uint8Array; stderr: Uint8Array },
  redactedValues: readonly string[] = [],
): string {
  let detail = safeDecodeBytes(result.stderr).trim() || safeDecodeBytes(result.stdout).trim();

  for (const secret of [...redactedValues].sort((left, right) => right.length - left.length)) {
    if (secret.length > 0) detail = detail.replaceAll(secret, "<redacted>");
  }

  detail = detail.replace(/\s+/gu, " ").trim().slice(0, 500);

  return detail.length > 0 ? `${prefix}: ${detail}` : prefix;
}

export function dockerFailureError(
  prefix: string,
  result: { stdout: Uint8Array; stderr: Uint8Array },
  redactedValues: readonly string[] = [],
): DockerSandboxError {
  const stderr = safeDecodeBytes(result.stderr);

  if (isDockerDaemonUnavailable(stderr)) {
    return new DockerSandboxError(
      formatDockerFailure("Docker daemon is not reachable", result, redactedValues),
      "docker_unavailable",
      result,
    );
  }

  return new DockerSandboxError(
    formatDockerFailure(prefix, result, redactedValues),
    "docker_command_failed",
    result,
  );
}

/** Classify a POSIX `st_mode` value. */
export function mapFileMode(mode: number): SandboxFileType {
  const type = mode & 0o170000;

  if (type === 0o100000) return "file";

  if (type === 0o040000) return "directory";

  if (type === 0o120000) return "symlink";

  return "other";
}
