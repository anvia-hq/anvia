import type { CommandResult } from "./run-command";
import type { SandboxExecResult, SandboxFileType } from "../types";

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

/** Classify a POSIX `st_mode` value. */
export function mapFileMode(mode: number): SandboxFileType {
  const type = mode & 0o170000;
  if (type === 0o100000) return "file";
  if (type === 0o040000) return "directory";
  if (type === 0o120000) return "symlink";
  return "other";
}
