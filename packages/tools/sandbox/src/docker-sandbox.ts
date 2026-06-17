import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { assertDockerCli, runDockerCli } from "./docker-cli";
import {
  SandboxDockerCommandError,
  SandboxFileSizeError,
  SandboxSessionDestroyedError,
  SandboxTimeoutError,
} from "./errors";
import { containerPath, normalizeSandboxPath, parentSandboxPath } from "./path";
import type {
  DockerSandboxOptions,
  Sandbox,
  SandboxCreateSessionOptions,
  SandboxExecOptions,
  SandboxExecResult,
  SandboxExecStreamEvent,
  SandboxFileEntry,
  SandboxFileType,
  SandboxHooks,
  SandboxLifecycleOptions,
  SandboxLimits,
  SandboxManifest,
  SandboxSession,
  SandboxSessionEvent,
  SandboxWorkspaceOptions,
} from "./types";

const defaultImage = "node:22-bookworm";
const defaultWorkdir = "/workspace";
const defaultTimeoutMs = 30_000;
const defaultMaxOutputBytes = 1024 * 1024;

export class DockerSandbox implements Sandbox {
  readonly provider = "docker";

  private readonly image: string;
  private readonly pull: "missing" | "always" | "never";
  private readonly workdir: string;
  private readonly workspace: SandboxWorkspaceOptions;
  private readonly lifecycle: Required<Pick<SandboxLifecycleOptions, "autoDestroy">> &
    Omit<SandboxLifecycleOptions, "autoDestroy">;
  private readonly network: NonNullable<DockerSandboxOptions["network"]>;
  private readonly dockerPath: string;
  private readonly labels: Record<string, string>;
  private readonly limits: SandboxLimits;
  private readonly security: Required<NonNullable<DockerSandboxOptions["security"]>>;
  private readonly hooks: SandboxHooks;
  private readonly user: string | undefined;

  constructor(options: DockerSandboxOptions = {}) {
    this.image = options.image ?? defaultImage;
    this.pull = options.pull ?? "missing";
    this.workdir = options.workdir ?? defaultWorkdir;
    this.workspace = options.workspace ?? { mode: "ephemeral" };
    this.lifecycle = {
      autoDestroy: options.lifecycle?.autoDestroy ?? true,
      ...(options.lifecycle?.ttlMs === undefined ? {} : { ttlMs: options.lifecycle.ttlMs }),
      ...(options.lifecycle?.idleTimeoutMs === undefined
        ? {}
        : { idleTimeoutMs: options.lifecycle.idleTimeoutMs }),
    };
    this.network = options.network ?? false;
    this.dockerPath = options.dockerPath ?? "docker";
    this.labels = options.labels ?? {};
    this.limits = options.limits ?? {};
    this.security = {
      readonlyRootfs: options.security?.readonlyRootfs ?? false,
      noNewPrivileges: options.security?.noNewPrivileges ?? true,
      dropCapabilities: options.security?.dropCapabilities ?? ["ALL"],
    };
    this.hooks = options.hooks ?? {};
    this.user = options.user;
  }

  static node(options: DockerSandboxOptions = {}): DockerSandbox {
    return new DockerSandbox({ ...options, image: options.image ?? "node:22-bookworm" });
  }

  static python(options: DockerSandboxOptions = {}): DockerSandbox {
    return new DockerSandbox({ ...options, image: options.image ?? "python:3.13-bookworm" });
  }

  static deno(options: DockerSandboxOptions = {}): DockerSandbox {
    return new DockerSandbox({ ...options, image: options.image ?? "denoland/deno:debian" });
  }

  async createSession(options: SandboxCreateSessionOptions = {}): Promise<SandboxSession> {
    await this.ensureImage();

    const id = sanitizeResourceId(options.id ?? randomUUID());
    const workspace = options.workspace ?? this.workspace;
    const workspaceId = getWorkspaceId(workspace, id);
    const containerName = `anvia-sandbox-${id}`;
    const volumeName = `anvia-sandbox-${workspaceId}-workspace`;
    const removeVolumeOnDestroy = shouldDestroyWorkspace(workspace);

    await assertDockerCli(["volume", "create", volumeName], this.cliOptions());

    try {
      await assertDockerCli(
        this.createRunArgs(containerName, volumeName, workspace, options.metadata),
        {
          ...this.cliOptions(),
          timeoutMs: this.limits.timeoutMs ?? defaultTimeoutMs,
        },
      );

      const session = new DockerSandboxSession({
        id,
        containerName,
        volumeName,
        workdir: this.workdir,
        dockerPath: this.dockerPath,
        limits: this.limits,
        lifecycle: this.lifecycle,
        removeVolumeOnDestroy,
        env: options.manifest?.env ?? {},
        hooks: this.hooks,
      });

      await session.applyManifest(options.manifest);
      await this.hooks.onSessionCreate?.(session.event());
      return session;
    } catch (error) {
      await this.cleanup(containerName, removeVolumeOnDestroy ? volumeName : undefined);
      throw error;
    }
  }

  private async ensureImage(): Promise<void> {
    if (this.pull === "always") {
      await assertDockerCli(["pull", this.image], this.cliOptions());
      return;
    }

    if (this.pull === "missing") {
      const inspect = await runDockerCli(["image", "inspect", this.image], this.cliOptions());
      if (inspect.exitCode !== 0) {
        await assertDockerCli(["pull", this.image], this.cliOptions());
      }
    }
  }

  private createRunArgs(
    containerName: string,
    volumeName: string,
    workspace: SandboxWorkspaceOptions,
    metadata: Record<string, string> | undefined,
  ): string[] {
    const args = [
      "run",
      "-d",
      "--name",
      containerName,
      "-v",
      `${volumeName}:${this.workdir}`,
      "-w",
      this.workdir,
      "--label",
      "anvia.sandbox=true",
      "--label",
      `anvia.sandbox.workspace.mode=${workspace.mode ?? "ephemeral"}`,
      "--label",
      `anvia.sandbox.workspace.volume=${volumeName}`,
    ];

    for (const [key, value] of Object.entries(this.labels)) {
      args.push("--label", `${key}=${value}`);
    }

    if (metadata !== undefined) {
      for (const [key, value] of Object.entries(metadata)) {
        args.push("--label", `anvia.sandbox.metadata.${key}=${value}`);
      }
    }

    this.appendNetworkArgs(args);
    this.appendLimitArgs(args);
    this.appendSecurityArgs(args);

    if (this.user !== undefined) {
      args.push("-u", this.user);
    }

    args.push(
      this.image,
      "sh",
      "-c",
      "trap 'exit 0' TERM INT; while :; do sleep 3600 & wait $!; done",
    );
    return args;
  }

  private appendNetworkArgs(args: string[]): void {
    const mode = typeof this.network === "object" ? this.network.mode : this.network;

    if (mode === false || mode === "none") {
      args.push("--network", "none");
      return;
    }

    if (mode !== true) {
      args.push("--network", mode);
    }
  }

  private appendLimitArgs(args: string[]): void {
    if (this.limits.memoryMb !== undefined) {
      args.push("--memory", `${this.limits.memoryMb}m`);
    }

    if (this.limits.cpus !== undefined) {
      args.push("--cpus", String(this.limits.cpus));
    }

    if (this.limits.pidsLimit !== undefined) {
      args.push("--pids-limit", String(this.limits.pidsLimit));
    }
  }

  private appendSecurityArgs(args: string[]): void {
    if (this.security.readonlyRootfs) {
      args.push("--read-only");
    }

    if (this.security.noNewPrivileges) {
      args.push("--security-opt", "no-new-privileges");
    }

    for (const capability of this.security.dropCapabilities) {
      args.push("--cap-drop", capability);
    }
  }

  private cliOptions() {
    return {
      dockerPath: this.dockerPath,
      maxOutputBytes: this.limits.maxOutputBytes ?? defaultMaxOutputBytes,
    };
  }

  private async cleanup(containerName: string, volumeName: string | undefined): Promise<void> {
    await runDockerCli(["rm", "-f", containerName], this.cliOptions()).catch(() => undefined);

    if (volumeName !== undefined) {
      await runDockerCli(["volume", "rm", "-f", volumeName], this.cliOptions()).catch(
        () => undefined,
      );
    }
  }
}

class DockerSandboxSession implements SandboxSession {
  readonly provider = "docker";
  readonly id: string;
  readonly workdir: string;

  private readonly containerName: string;
  private readonly volumeName: string;
  private readonly dockerPath: string;
  private readonly limits: SandboxLimits;
  private readonly lifecycle: Required<Pick<SandboxLifecycleOptions, "autoDestroy">> &
    Omit<SandboxLifecycleOptions, "autoDestroy">;
  private readonly removeVolumeOnDestroy: boolean;
  private readonly env: Record<string, string>;
  private readonly hooks: SandboxHooks;
  private ttlTimer: ReturnType<typeof setTimeout> | undefined;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private activeOperations = 0;
  private destroyed = false;

  constructor(options: {
    id: string;
    containerName: string;
    volumeName: string;
    workdir: string;
    dockerPath: string;
    limits: SandboxLimits;
    lifecycle: Required<Pick<SandboxLifecycleOptions, "autoDestroy">> &
      Omit<SandboxLifecycleOptions, "autoDestroy">;
    removeVolumeOnDestroy: boolean;
    env: Record<string, string>;
    hooks: SandboxHooks;
  }) {
    this.id = options.id;
    this.containerName = options.containerName;
    this.volumeName = options.volumeName;
    this.workdir = options.workdir;
    this.dockerPath = options.dockerPath;
    this.limits = options.limits;
    this.lifecycle = options.lifecycle;
    this.removeVolumeOnDestroy = options.removeVolumeOnDestroy;
    this.env = options.env;
    this.hooks = options.hooks;
    this.startLifecycleTimers();
  }

  async applyManifest(manifest: SandboxManifest | undefined): Promise<void> {
    await this.runOperation(async () => {
      for (const directory of manifest?.directories ?? []) {
        await this.mkdir(directory);
      }

      for (const [filePath, content] of Object.entries(manifest?.files ?? {})) {
        await this.writeFile(filePath, content);
      }
    });
  }

  async exec(options: SandboxExecOptions): Promise<SandboxExecResult> {
    return this.runOperation(async () => {
      await this.hooks.onExecStart?.({
        ...this.event(),
        command: options.command,
        args: options.args ?? [],
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      });

      const normalizedResult = await this.execCommand(options);

      await this.hooks.onExecEnd?.({
        ...this.event(),
        command: options.command,
        args: options.args ?? [],
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        result: normalizedResult,
      });

      return normalizedResult;
    });
  }

  async *execStream(options: SandboxExecOptions): AsyncIterable<SandboxExecStreamEvent> {
    const events: SandboxExecStreamEvent[] = [];
    let notify: (() => void) | undefined;
    let done = false;
    let error: unknown;

    const push = (event: SandboxExecStreamEvent) => {
      events.push(event);
      notify?.();
      notify = undefined;
    };

    const wait = () =>
      new Promise<void>((resolve) => {
        notify = resolve;
      });

    const run = this.exec({
      ...options,
      onStdout: (chunk) => {
        options.onStdout?.(chunk);
        push({ type: "stdout", chunk, text: Buffer.from(chunk).toString("utf8") });
      },
      onStderr: (chunk) => {
        options.onStderr?.(chunk);
        push({ type: "stderr", chunk, text: Buffer.from(chunk).toString("utf8") });
      },
    })
      .then((result) => {
        push({ type: "exit", result });
      })
      .catch((caught) => {
        error = caught;
      })
      .finally(() => {
        done = true;
        notify?.();
        notify = undefined;
      });

    try {
      while (!done || events.length > 0) {
        const event = events.shift();
        if (event !== undefined) {
          yield event;
          continue;
        }

        await wait();
      }

      if (error !== undefined) {
        throw error;
      }
    } finally {
      await run;
    }
  }

  async readFile(filePath: string): Promise<Uint8Array> {
    return this.runOperation(async () => {
      const normalized = normalizeSandboxPath(filePath);
      const tempDir = await mkdtemp(path.join(os.tmpdir(), "anvia-sandbox-read-"));
      const target = path.join(tempDir, path.basename(normalized));

      try {
        await assertDockerCli(
          ["cp", `${this.containerName}:${containerPath(this.workdir, normalized)}`, target],
          this.cliOptions(),
        );
        const { readFile } = await import("node:fs/promises");
        const bytes = await readFile(target);
        this.assertFileSize(bytes.byteLength, filePath);
        return bytes;
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    });
  }

  async readTextFile(filePath: string): Promise<string> {
    const bytes = await this.readFile(filePath);
    return new TextDecoder().decode(bytes);
  }

  async writeFile(filePath: string, data: string | Uint8Array): Promise<void> {
    await this.runOperation(async () => {
      const size = byteLength(data);
      this.assertFileSize(size, filePath);
      const normalized = normalizeSandboxPath(filePath);
      await this.mkdir(parentSandboxPath(normalized));

      const tempDir = await mkdtemp(path.join(os.tmpdir(), "anvia-sandbox-write-"));
      const source = path.join(tempDir, path.basename(normalized));

      try {
        await writeFile(source, data);
        await assertDockerCli(
          ["cp", source, `${this.containerName}:${containerPath(this.workdir, normalized)}`],
          this.cliOptions(),
        );
        await this.hooks.onFileWrite?.({ ...this.event(), path: normalized, size });
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    });
  }

  async writeTextFile(filePath: string, content: string): Promise<void> {
    await this.writeFile(filePath, content);
  }

  async listFiles(filePath = "."): Promise<SandboxFileEntry[]> {
    return this.runOperation(async () => {
      const normalized = normalizeSandboxPath(filePath, { allowRoot: true });
      const target = containerPath(this.workdir, normalized);
      const result = await this.execCommand({
        command: "find",
        args: [target, "-mindepth", "1", "-maxdepth", "1", "-printf", "%p\t%y\t%s\n"],
      });

      if (result.timedOut) {
        throw new SandboxTimeoutError(`Listing files timed out for ${filePath}.`);
      }

      if (result.exitCode !== 0) {
        throw new SandboxDockerCommandError(`Unable to list sandbox path: ${filePath}`, result);
      }

      return result.stdout
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .map((line) => this.parseFindEntry(line));
    });
  }

  async destroy(): Promise<void> {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;
    this.clearLifecycleTimers();
    await runDockerCli(["rm", "-f", this.containerName], this.cliOptions()).catch(() => undefined);

    if (this.removeVolumeOnDestroy) {
      await runDockerCli(["volume", "rm", "-f", this.volumeName], this.cliOptions()).catch(
        () => undefined,
      );
    }

    await this.hooks.onDestroy?.(this.event());
  }

  private async mkdir(directoryPath: string): Promise<void> {
    const normalized = normalizeSandboxPath(directoryPath, { allowRoot: true });
    const result = await this.execCommand({
      command: "mkdir",
      args: ["-p", containerPath(this.workdir, normalized)],
    });

    if (result.exitCode !== 0) {
      throw new SandboxDockerCommandError(
        `Unable to create sandbox directory: ${directoryPath}`,
        result,
      );
    }
  }

  private parseFindEntry(line: string): SandboxFileEntry {
    const [rawPath, rawType, rawSize] = line.split("\t");
    const absolutePath = rawPath ?? "";
    const relativePath = absolutePath.startsWith(`${this.workdir}/`)
      ? absolutePath.slice(this.workdir.length + 1)
      : absolutePath;
    const size = rawSize === undefined ? undefined : Number(rawSize);
    const entry: SandboxFileEntry = {
      path: relativePath,
      type: mapFindType(rawType),
    };

    if (size !== undefined && Number.isFinite(size)) {
      entry.size = size;
    }

    return entry;
  }

  private cliOptions() {
    return {
      dockerPath: this.dockerPath,
      maxOutputBytes: this.limits.maxOutputBytes ?? defaultMaxOutputBytes,
    };
  }

  private async execCommand(options: SandboxExecOptions): Promise<SandboxExecResult> {
    if (options.command.trim().length === 0) {
      throw new SandboxDockerCommandError("Sandbox command cannot be empty.", {
        stdout: "",
        stderr: "",
        exitCode: 1,
      });
    }

    const args = ["exec"];

    if (options.input !== undefined) {
      args.push("-i");
    }

    const cwd = containerPath(this.workdir, options.cwd ?? ".");
    args.push("-w", cwd);

    for (const [key, value] of Object.entries({ ...this.env, ...options.env })) {
      args.push("-e", `${key}=${value}`);
    }

    args.push(this.containerName, options.command, ...(options.args ?? []));

    const cliOptions = {
      dockerPath: this.dockerPath,
      timeoutMs: options.timeoutMs ?? this.limits.timeoutMs ?? defaultTimeoutMs,
      maxOutputBytes: this.limits.maxOutputBytes ?? defaultMaxOutputBytes,
      ...(options.input === undefined ? {} : { input: options.input }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      ...(options.onStdout === undefined ? {} : { onStdout: options.onStdout }),
      ...(options.onStderr === undefined ? {} : { onStderr: options.onStderr }),
    };

    const result = await runDockerCli(args, cliOptions);

    if (result.timedOut) {
      return {
        ...result,
        exitCode: result.exitCode === 0 ? 124 : result.exitCode,
      };
    }

    return result;
  }

  private assertActive(): void {
    if (this.destroyed) {
      throw new SandboxSessionDestroyedError(`Sandbox session ${this.id} has been destroyed.`);
    }
  }

  event(): SandboxSessionEvent {
    return {
      sessionId: this.id,
      provider: this.provider,
      workdir: this.workdir,
    };
  }

  private async runOperation<T>(operation: () => Promise<T>): Promise<T> {
    this.assertActive();
    this.activeOperations += 1;
    this.clearIdleTimer();

    try {
      return await operation();
    } finally {
      this.activeOperations -= 1;
      this.scheduleIdleTimer();
    }
  }

  private assertFileSize(size: number, filePath: string): void {
    if (this.limits.maxFileBytes !== undefined && size > this.limits.maxFileBytes) {
      throw new SandboxFileSizeError(
        `Sandbox file exceeds maxFileBytes (${size} > ${this.limits.maxFileBytes}): ${filePath}`,
      );
    }
  }

  private startLifecycleTimers(): void {
    if (!this.lifecycle.autoDestroy) {
      return;
    }

    if (this.lifecycle.ttlMs !== undefined) {
      this.ttlTimer = setTimeout(() => {
        void this.destroy().catch(() => undefined);
      }, this.lifecycle.ttlMs);
      this.ttlTimer.unref?.();
    }

    this.scheduleIdleTimer();
  }

  private scheduleIdleTimer(): void {
    if (!this.lifecycle.autoDestroy || this.lifecycle.idleTimeoutMs === undefined) {
      return;
    }

    if (this.destroyed || this.activeOperations > 0) {
      return;
    }

    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      void this.destroy().catch(() => undefined);
    }, this.lifecycle.idleTimeoutMs);
    this.idleTimer.unref?.();
  }

  private clearLifecycleTimers(): void {
    if (this.ttlTimer !== undefined) {
      clearTimeout(this.ttlTimer);
      this.ttlTimer = undefined;
    }
    this.clearIdleTimer();
  }

  private clearIdleTimer(): void {
    if (this.idleTimer !== undefined) {
      clearTimeout(this.idleTimer);
      this.idleTimer = undefined;
    }
  }
}

function getWorkspaceId(workspace: SandboxWorkspaceOptions, sessionId: string): string {
  if (workspace.mode === "persistent") {
    return sanitizeResourceId(workspace.id);
  }

  return sessionId;
}

function shouldDestroyWorkspace(workspace: SandboxWorkspaceOptions): boolean {
  if (workspace.mode === "persistent") {
    return workspace.destroyOnSessionDestroy ?? false;
  }

  return true;
}

function sanitizeResourceId(id: string): string {
  const sanitized = id
    .toLowerCase()
    .replaceAll(/[^a-z0-9_.-]/g, "-")
    .replaceAll(/^-+|-+$/g, "");
  return sanitized.length > 0 ? sanitized : randomUUID();
}

function byteLength(data: string | Uint8Array): number {
  return typeof data === "string" ? Buffer.byteLength(data) : data.byteLength;
}

function mapFindType(type: string | undefined): SandboxFileType {
  if (type === "f") {
    return "file";
  }
  if (type === "d") {
    return "directory";
  }
  if (type === "l") {
    return "symlink";
  }
  return "other";
}
