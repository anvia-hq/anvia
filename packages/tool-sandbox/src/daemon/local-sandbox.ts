import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, readdir, realpath, rename, rm } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { DockerSandboxError } from "../errors";
import { containerPath, isPathInside, normalizeSandboxPath, parentSandboxPath } from "../path";
import {
  type ResolvedRuntimeLimits,
  assertFileSize,
  resolveRuntimeLimits,
  validateRuntimeLimits,
} from "../shared/limits";
import { decodeUtf8 } from "../shared/output";
import { mapFileMode, toExecResult } from "../shared/result";
import { runCommand } from "../shared/run-command";
import {
  assertNonEmptyString,
  assertNonNegativeSafeInteger,
  assertOptionsObject,
  assertReadOptions,
  copyStringRecord,
  resolvePortWaitOptions,
  resolveTextFilePageOptions,
  validateExecOptions,
  validateProcessStartOptions,
  waitWithSignal,
} from "../shared/validation";
import { createTextFilePage } from "../text-file";
import type {
  SandboxExecOptions,
  SandboxExecResult,
  SandboxFileEntry,
  SandboxPortStatus,
  SandboxProcessInfo,
  SandboxProcessLogs,
  SandboxProcessStartOptions,
  SandboxReadFileOptions,
  SandboxReadTextFilePageOptions,
  SandboxRuntimeLimits,
  SandboxTextFilePage,
  SandboxWaitForPortOptions,
  SandboxWriteFileOptions,
} from "../types";
import { LocalProcessManager } from "./processes";

/** Variables that authenticate the daemon itself and must never reach agent-run commands. */
const daemonSecretVariables = ["ANVIA_SANDBOX_TOKEN", "ANVIA_CONTROL_URL"] as const;

export interface LocalSandboxOptions {
  /** Absolute directory that file operations are confined to and commands start in. */
  workdir: string;
  limits?: SandboxRuntimeLimits | undefined;
  /** Environment added to every command, on top of the daemon's own (minus its credentials). */
  env?: Readonly<Record<string, string>> | undefined;
}

/**
 * Executes sandbox operations on the machine the daemon runs on. It is the in-sandbox
 * counterpart of the Docker runtime and applies the same path, size, and output rules.
 */
export class LocalSandbox {
  readonly workdir: string;
  readonly limits: ResolvedRuntimeLimits;
  private readonly env: Record<string, string>;
  private readonly processes: LocalProcessManager;

  constructor(options: LocalSandboxOptions) {
    if (!path.posix.isAbsolute(options.workdir)) {
      throw new TypeError("workdir must be an absolute path.");
    }
    validateRuntimeLimits(options.limits);
    this.workdir = path.posix.normalize(options.workdir);
    this.limits = resolveRuntimeLimits(options.limits);
    this.env = copyStringRecord(options.env, "env");
    this.processes = new LocalProcessManager({
      maxOutputBytes: this.limits.maxOutputBytes,
      maxProcesses: this.limits.maxProcesses,
      environment: (extra) => this.environment(extra),
    });
  }

  async exec(
    options: SandboxExecOptions,
    hooks: {
      onStdout?: (chunk: Uint8Array) => void;
      onStderr?: (chunk: Uint8Array) => void;
    } = {},
  ): Promise<SandboxExecResult> {
    validateExecOptions(options);
    options.abortSignal?.throwIfAborted();
    const cwd = containerPath(this.workdir, options.cwd ?? ".");
    if (!(await isDirectory(cwd))) {
      return missingWorkingDirectory(options.cwd ?? ".");
    }
    const result = await runCommand(options.command, options.args ?? [], {
      cwd,
      env: this.environment(options.env),
      input: options.input,
      timeoutMs: options.timeoutMs ?? this.limits.commandTimeoutMs,
      maxOutputBytes: this.limits.maxOutputBytes,
      signal: options.abortSignal,
      killProcessGroup: true,
      exitGraceMs: 200,
      onStdout: hooks.onStdout,
      onStderr: hooks.onStderr,
      mapSpawnError: (error) => {
        const message = `anvia: ${error.code === "EACCES" ? "permission denied" : "command not found"}: ${options.command}\n`;
        return {
          stdout: new Uint8Array(),
          stderr: new TextEncoder().encode(message),
          exitCode: error.code === "EACCES" ? 126 : 127,
          durationMs: 0,
          timedOut: false,
          stdoutTruncated: false,
          stderrTruncated: false,
        };
      },
    });
    return toExecResult(result);
  }

  async readFile(options: SandboxReadFileOptions): Promise<Uint8Array> {
    assertReadOptions(options);
    options.abortSignal?.throwIfAborted();
    const normalized = normalizeSandboxPath(options.path);
    const target = containerPath(this.workdir, normalized);
    await this.assertInsideWorkdir(path.posix.dirname(target), normalized);
    const metadata = await lstatOrNull(target);
    if (metadata === null) {
      throw new DockerSandboxError(`Sandbox file not found: ${normalized}`, "invalid_path");
    }
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw new DockerSandboxError(
        `Sandbox path is not a regular file: ${normalized}`,
        "invalid_path",
      );
    }
    assertFileSize(metadata.size, normalized, this.limits.maxFileBytes);
    const bytes = await readFile(target, { signal: options.abortSignal });
    assertFileSize(bytes.byteLength, normalized, this.limits.maxFileBytes);
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength).slice();
  }

  async readTextFilePage(options: SandboxReadTextFilePageOptions): Promise<SandboxTextFilePage> {
    assertReadOptions(options);
    const page = resolveTextFilePageOptions(options);
    const text = decodeUtf8(await this.readFile(options));
    return createTextFilePage(text, page);
  }

  async writeFile(options: SandboxWriteFileOptions): Promise<void> {
    assertOptionsObject(options);
    if (!(options.data instanceof Uint8Array)) throw new TypeError("data must be a Uint8Array.");
    const normalized = normalizeSandboxPath(options.path);
    assertFileSize(options.data.byteLength, normalized, this.limits.maxFileBytes);
    options.abortSignal?.throwIfAborted();

    // Reject a symlink in any component, including dangling parents, before and after creating
    // parent directories so neither step follows a link out of the workspace. Best effort: the
    // inspection and the write are separate operations.
    await this.assertNoSymlinks(normalized);
    await mkdir(containerPath(this.workdir, parentSandboxPath(normalized)), { recursive: true });
    await this.assertNoSymlinks(normalized);
    await this.assertInsideWorkdir(
      path.posix.dirname(containerPath(this.workdir, normalized)),
      normalized,
    );

    // Write beside the target and rename so a reader never sees a partial file and a crash never
    // leaves one. The rename replaces a directory entry; it never writes through a link.
    const target = containerPath(this.workdir, normalized);
    const temporary = `${target}.anvia-${randomUUID()}.tmp`;
    try {
      const handle = await open(temporary, "wx", 0o644);
      try {
        await handle.writeFile(options.data, { signal: options.abortSignal });
      } finally {
        await handle.close();
      }
      options.abortSignal?.throwIfAborted();
      await rename(temporary, target);
    } finally {
      await rm(temporary, { force: true });
    }
  }

  async listFiles(
    options: { path?: string; abortSignal?: AbortSignal } = {},
  ): Promise<readonly SandboxFileEntry[]> {
    assertOptionsObject(options);
    options.abortSignal?.throwIfAborted();
    const normalized = normalizeSandboxPath(options.path ?? ".", { allowRoot: true });
    const directory = containerPath(this.workdir, normalized);
    await this.assertInsideWorkdir(directory, normalized);
    let names: string[];
    try {
      names = await readdir(directory);
    } catch (error) {
      throw new DockerSandboxError(
        `Unable to list sandbox files: ${normalized}`,
        "invalid_path",
        undefined,
        { cause: error },
      );
    }
    const entries: SandboxFileEntry[] = [];
    for (const name of names) {
      const metadata = await lstatOrNull(path.posix.join(directory, name));
      if (metadata === null) continue;
      const type = mapFileMode(metadata.mode);
      const entryPath = normalized === "." ? name : path.posix.join(normalized, name);
      entries.push(
        type === "file"
          ? { path: entryPath, type, size: metadata.size }
          : { path: entryPath, type },
      );
    }
    return entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  }

  async startProcess(options: SandboxProcessStartOptions): Promise<SandboxProcessInfo> {
    validateProcessStartOptions(options);
    const cwd = containerPath(this.workdir, options.cwd ?? ".");
    if (!(await isDirectory(cwd))) {
      throw new DockerSandboxError(
        `Sandbox working directory not found: ${options.cwd ?? "."}`,
        "invalid_path",
      );
    }
    return this.processes.start(options, cwd, options.abortSignal);
  }

  async listProcesses(): Promise<readonly SandboxProcessInfo[]> {
    return this.processes.list();
  }

  async readProcessLogs(options: {
    processId: string;
    tailBytes?: number;
  }): Promise<SandboxProcessLogs> {
    assertOptionsObject(options);
    assertNonEmptyString(options.processId, "processId");
    if (options.tailBytes !== undefined)
      assertNonNegativeSafeInteger(options.tailBytes, "tailBytes");
    return this.processes.logs(options.processId, options.tailBytes);
  }

  async stopProcess(options: {
    processId: string;
    gracePeriodMs?: number;
    abortSignal?: AbortSignal;
  }): Promise<SandboxProcessInfo> {
    assertOptionsObject(options);
    assertNonEmptyString(options.processId, "processId");
    if (options.gracePeriodMs !== undefined) {
      assertNonNegativeSafeInteger(options.gracePeriodMs, "gracePeriodMs");
    }
    return this.processes.stop(options.processId, options.gracePeriodMs, options.abortSignal);
  }

  /** Resolve once something accepts TCP connections on the sandbox's loopback interface. */
  async waitForPort(
    options: SandboxWaitForPortOptions & { abortSignal: AbortSignal },
  ): Promise<SandboxPortStatus> {
    assertOptionsObject(options);
    const { timeoutMs, intervalMs } = resolvePortWaitOptions(options);
    const deadline = Date.now() + timeoutMs;
    while (true) {
      options.abortSignal.throwIfAborted();
      if (await probePort(options.containerPort, Math.min(1_000, timeoutMs))) {
        return { containerPort: options.containerPort, protocol: "tcp" };
      }
      if (Date.now() >= deadline) {
        throw new DockerSandboxError(
          `Waiting for sandbox port timed out: ${options.containerPort}`,
          "timeout",
        );
      }
      await waitWithSignal(Math.min(intervalMs, deadline - Date.now()), options.abortSignal);
    }
  }

  /** Where a terminal starts and what it inherits: the daemon's environment minus credentials. */
  async terminalContext(
    cwd?: string,
    env?: Readonly<Record<string, string>>,
  ): Promise<{ cwd: string; env: Record<string, string> }> {
    const resolved = containerPath(this.workdir, cwd ?? ".");
    if (!(await isDirectory(resolved))) {
      throw new DockerSandboxError(
        `Sandbox working directory not found: ${cwd ?? "."}`,
        "invalid_path",
      );
    }
    return { cwd: resolved, env: this.commandEnvironment(env) };
  }

  /** The environment commands run with, as plain strings. */
  commandEnvironment(extra?: Readonly<Record<string, string>>): Record<string, string> {
    const entries = Object.entries(this.environment(extra));
    return Object.fromEntries(
      entries.filter((entry): entry is [string, string] => entry[1] !== undefined),
    );
  }

  async dispose(): Promise<void> {
    await this.processes.dispose();
  }

  private environment(extra?: Readonly<Record<string, string>>): NodeJS.ProcessEnv {
    const base: NodeJS.ProcessEnv = { ...process.env };
    for (const name of daemonSecretVariables) delete base[name];
    return { ...base, ...this.env, ...extra };
  }

  private async assertNoSymlinks(sandboxPath: string): Promise<void> {
    let current = this.workdir;
    for (const part of sandboxPath.split("/")) {
      current = path.posix.join(current, part);
      const metadata = await lstatOrNull(current);
      if (metadata === null) return;
      if (metadata.isSymbolicLink()) {
        throw new DockerSandboxError(
          `Sandbox path contains a symbolic link: ${sandboxPath}`,
          "invalid_path",
        );
      }
    }
  }

  /** The real location of `directory` must stay inside the real workdir. */
  private async assertInsideWorkdir(directory: string, sandboxPath: string): Promise<void> {
    let resolvedDirectory: string;
    try {
      resolvedDirectory = await realpath(directory);
    } catch (error) {
      throw new DockerSandboxError(
        `Sandbox path not found: ${sandboxPath}`,
        "invalid_path",
        undefined,
        { cause: error },
      );
    }
    const resolvedWorkdir = await realpath(this.workdir);
    if (!isPathInside(resolvedWorkdir, resolvedDirectory, { allowSame: true })) {
      throw new DockerSandboxError(
        `Sandbox path escapes the workspace: ${sandboxPath}`,
        "invalid_path",
      );
    }
  }
}

async function lstatOrNull(target: string) {
  try {
    return await lstat(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function isDirectory(target: string): Promise<boolean> {
  const metadata = await lstatOrNull(target);
  return metadata !== null && (metadata.isDirectory() || metadata.isSymbolicLink());
}

function missingWorkingDirectory(cwd: string): SandboxExecResult {
  return {
    status: "exited",
    exitCode: 126,
    stdout: new Uint8Array(),
    stderr: new TextEncoder().encode(`anvia: working directory not found: ${cwd}\n`),
    durationMs: 0,
    stdoutTruncated: false,
    stderrTruncated: false,
  };
}

async function probePort(port: number, timeoutMs: number): Promise<boolean> {
  for (const host of ["127.0.0.1", "::1"]) {
    const connected = await new Promise<boolean>((resolve) => {
      const socket = net.connect({ port, host });
      const finish = (value: boolean) => {
        socket.destroy();
        resolve(value);
      };
      socket.setTimeout(timeoutMs, () => finish(false));
      socket.once("connect", () => finish(true));
      socket.once("error", () => finish(false));
    });
    if (connected) return true;
  }
  return false;
}
