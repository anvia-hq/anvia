import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { assertDockerCli, type DockerCliOptions, runDockerCli } from "./docker-cli";
import { DockerProcessManager } from "./docker-process";
import {
  SandboxDockerCommandError,
  SandboxFileSizeError,
  SandboxPortError,
  SandboxSessionDestroyedError,
  SandboxTimeoutError,
} from "./errors";
import { containerPath, normalizeSandboxPath, parentSandboxPath } from "./path";
import type {
  DockerSandboxCreateSessionOptions,
  DockerSandboxOptions,
  DockerSandboxSession,
  Sandbox,
  SandboxExecEndEvent,
  SandboxExecEvent,
  SandboxExecOptions,
  SandboxExecResult,
  SandboxExecStreamEvent,
  SandboxFileEntry,
  SandboxFileType,
  SandboxHooks,
  SandboxLifecycleOptions,
  SandboxLimits,
  SandboxManifest,
  SandboxProcessInfo,
  SandboxProcessLogs,
  SandboxProcessLogsOptions,
  SandboxProcessStartOptions,
  SandboxProcessStopOptions,
  SandboxPublishedPort,
  SandboxSessionEvent,
  SandboxWaitForPortOptions,
  SandboxWorkspaceOptions,
} from "./types";

const defaultImage = "node:22-bookworm";
const defaultWorkdir = "/workspace";
const defaultTimeoutMs = 30_000;
const defaultMaxOutputBytes = 1024 * 1024;
const defaultMaxProcesses = 4;
// Docker Desktop may accept a host-side TCP connection before a container service is ready. Probe
// Linux socket state in the container so readiness requires an all-interface listening socket.
const portProbeScript = [
  'port="$(printf \'%04X\' "$1")"',
  "for table in /proc/net/tcp /proc/net/tcp6; do",
  '  [ -r "$table" ] || continue',
  "  while read -r _ local _ state _; do",
  '    case "$local" in',
  '      "00000000:$port"|"00000000000000000000000000000000:$port")',
  '        [ "$state" = "0A" ] && exit 0',
  "        ;;",
  "    esac",
  '  done < "$table"',
  "done",
  "exit 1",
].join("\n");

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
    const lifecycle: Required<Pick<SandboxLifecycleOptions, "autoDestroy">> &
      Omit<SandboxLifecycleOptions, "autoDestroy"> = {
      autoDestroy: options.lifecycle?.autoDestroy ?? true,
    };
    if (options.lifecycle?.ttlMs !== undefined) lifecycle.ttlMs = options.lifecycle.ttlMs;
    if (options.lifecycle?.idleTimeoutMs !== undefined) {
      lifecycle.idleTimeoutMs = options.lifecycle.idleTimeoutMs;
    }
    this.lifecycle = lifecycle;
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

  async createSession(
    options: DockerSandboxCreateSessionOptions = {},
  ): Promise<DockerSandboxSession> {
    const ports = validatePublishedPorts(options.ports ?? []);
    this.assertPortNetworkCompatible(ports);
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
        this.createRunArgs(containerName, volumeName, workspace, options.metadata, ports),
        {
          ...this.cliOptions(),
          timeoutMs: this.limits.timeoutMs ?? defaultTimeoutMs,
        },
      );

      const publishedPorts = await this.inspectPublishedPorts(containerName, ports);

      const session = new DockerSandboxSessionImpl({
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
        publishedPorts,
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
    ports: readonly number[],
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
    for (const port of ports) {
      args.push("--publish", `127.0.0.1::${port}/tcp`);
    }
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

  private assertPortNetworkCompatible(ports: readonly number[]): void {
    if (ports.length === 0) return;
    const mode = typeof this.network === "object" ? this.network.mode : this.network;
    if (
      mode === false ||
      mode === "none" ||
      mode === "host" ||
      (typeof mode === "string" && mode.startsWith("container:"))
    ) {
      throw new SandboxPortError(
        "Published sandbox ports require network: true or a bridge-capable Docker network.",
      );
    }
  }

  private async inspectPublishedPorts(
    containerName: string,
    ports: readonly number[],
  ): Promise<SandboxPublishedPort[]> {
    if (ports.length === 0) return [];

    const raw = await assertDockerCli(
      ["container", "inspect", "--format", "{{json .NetworkSettings.Ports}}", containerName],
      this.cliOptions(),
    );
    let mappings: unknown;
    try {
      mappings = JSON.parse(raw);
    } catch (error) {
      throw new SandboxPortError("Docker returned invalid published port metadata.", error);
    }
    if (!isRecord(mappings)) {
      throw new SandboxPortError("Docker returned invalid published port metadata.");
    }

    return ports.map((containerPort) => {
      const entries = mappings[`${containerPort}/tcp`];
      if (!Array.isArray(entries)) {
        throw new SandboxPortError(`Docker did not publish sandbox port ${containerPort}/tcp.`);
      }
      const entry = entries.find(
        (candidate) =>
          isRecord(candidate) &&
          candidate.HostIp === "127.0.0.1" &&
          typeof candidate.HostPort === "string",
      );
      if (!isRecord(entry) || typeof entry.HostPort !== "string") {
        throw new SandboxPortError(
          `Docker did not bind sandbox port ${containerPort}/tcp to 127.0.0.1.`,
        );
      }
      const hostPort = Number(entry.HostPort);
      if (!isValidPort(hostPort)) {
        throw new SandboxPortError(
          `Docker returned an invalid host port for ${containerPort}/tcp.`,
        );
      }
      return { containerPort, host: "127.0.0.1", hostPort, protocol: "tcp" };
    });
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

class DockerSandboxSessionImpl implements DockerSandboxSession {
  readonly provider = "docker";
  readonly id: string;
  readonly workdir: string;
  readonly publishedPorts: readonly SandboxPublishedPort[];

  private readonly containerName: string;
  private readonly volumeName: string;
  private readonly dockerPath: string;
  private readonly limits: SandboxLimits;
  private readonly lifecycle: Required<Pick<SandboxLifecycleOptions, "autoDestroy">> &
    Omit<SandboxLifecycleOptions, "autoDestroy">;
  private readonly removeVolumeOnDestroy: boolean;
  private readonly env: Record<string, string>;
  private readonly hooks: SandboxHooks;
  private readonly processManager: DockerProcessManager;
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
    publishedPorts: SandboxPublishedPort[];
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
    this.publishedPorts = options.publishedPorts;
    this.processManager = new DockerProcessManager({
      containerName: this.containerName,
      dockerPath: this.dockerPath,
      workdir: this.workdir,
      env: this.env,
      maxOutputBytes: this.limits.maxOutputBytes ?? defaultMaxOutputBytes,
      maxProcesses: this.limits.maxProcesses ?? defaultMaxProcesses,
      startupTimeoutMs: this.limits.timeoutMs ?? defaultTimeoutMs,
      onExit: async (process, logs, durationMs) => {
        const event: SandboxExecEndEvent = {
          ...this.event(),
          command: process.command,
          args: process.args,
          result: {
            stdout: logs.stdout,
            stderr: logs.stderr,
            exitCode: process.exitCode ?? 1,
            durationMs,
            timedOut: false,
            aborted: process.status === "stopped",
            stdoutTruncated: logs.stdoutTruncated,
            stderrTruncated: logs.stderrTruncated,
          },
        };
        if (process.cwd !== undefined) event.cwd = process.cwd;
        await this.hooks.onExecEnd?.(event);
      },
    });
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
      const startEvent: SandboxExecEvent = {
        ...this.event(),
        command: options.command,
        args: options.args ?? [],
      };
      if (options.cwd !== undefined) startEvent.cwd = options.cwd;
      await this.hooks.onExecStart?.(startEvent);

      const normalizedResult = await this.execCommand(options);

      const endEvent: SandboxExecEndEvent = {
        ...this.event(),
        command: options.command,
        args: options.args ?? [],
        result: normalizedResult,
      };
      if (options.cwd !== undefined) endEvent.cwd = options.cwd;
      await this.hooks.onExecEnd?.(endEvent);

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

  async startProcess(options: SandboxProcessStartOptions): Promise<SandboxProcessInfo> {
    return this.runOperation(async () => {
      const event: SandboxExecEvent = {
        ...this.event(),
        command: options.command,
        args: options.args ?? [],
      };
      if (options.cwd !== undefined) event.cwd = options.cwd;
      await this.hooks.onExecStart?.(event);
      return this.processManager.start(options);
    });
  }

  async listProcesses(): Promise<SandboxProcessInfo[]> {
    return this.runOperation(async () => this.processManager.list());
  }

  async readProcessLogs(
    processId: string,
    options?: SandboxProcessLogsOptions,
  ): Promise<SandboxProcessLogs> {
    return this.runOperation(async () => this.processManager.logs(processId, options));
  }

  async stopProcess(
    processId: string,
    options?: SandboxProcessStopOptions,
  ): Promise<SandboxProcessInfo> {
    return this.runOperation(async () => this.processManager.stop(processId, options));
  }

  async waitForPort(
    containerPort: number,
    options: SandboxWaitForPortOptions = {},
  ): Promise<SandboxPublishedPort> {
    return this.runOperation(async () => {
      const publishedPort = this.publishedPorts.find(
        (candidate) => candidate.containerPort === containerPort,
      );
      if (publishedPort === undefined) {
        throw new SandboxPortError(`Sandbox port is not published: ${containerPort}/tcp`);
      }

      const timeoutMs = options.timeoutMs ?? this.limits.timeoutMs ?? defaultTimeoutMs;
      const intervalMs = options.intervalMs ?? 250;
      assertWaitOptions(timeoutMs, intervalMs);
      const deadline = Date.now() + timeoutMs;

      while (true) {
        this.assertActive();
        if (options.signal?.aborted === true) throw abortReason(options.signal);
        const probeTimeoutMs = Math.max(1, Math.min(1_000, deadline - Date.now()));
        if (await this.isPortListening(containerPort, probeTimeoutMs)) {
          return publishedPort;
        }
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) {
          throw new SandboxTimeoutError(`Waiting for sandbox port ${containerPort}/tcp timed out.`);
        }
        await waitWithSignal(Math.min(intervalMs, remainingMs), options.signal);
      }
    });
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
    const processCleanup = this.processManager.dispose();
    await runDockerCli(["rm", "-f", this.containerName], this.cliOptions()).catch(() => undefined);
    await processCleanup;

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

  private async isPortListening(containerPort: number, timeoutMs: number): Promise<boolean> {
    const result = await runDockerCli(
      [
        "exec",
        this.containerName,
        "sh",
        "-c",
        portProbeScript,
        "anvia-port-probe",
        String(containerPort),
      ],
      {
        ...this.cliOptions(),
        timeoutMs: Math.max(1, timeoutMs),
      },
    );
    return result.exitCode === 0;
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

    const cliOptions: DockerCliOptions = {
      dockerPath: this.dockerPath,
      timeoutMs: options.timeoutMs ?? this.limits.timeoutMs ?? defaultTimeoutMs,
      maxOutputBytes: this.limits.maxOutputBytes ?? defaultMaxOutputBytes,
    };
    if (options.input !== undefined) cliOptions.input = options.input;
    if (options.signal !== undefined) cliOptions.signal = options.signal;
    if (options.onStdout !== undefined) cliOptions.onStdout = options.onStdout;
    if (options.onStderr !== undefined) cliOptions.onStderr = options.onStderr;

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

function validatePublishedPorts(ports: readonly number[]): number[] {
  const unique = new Set<number>();
  for (const port of ports) {
    if (!isValidPort(port)) {
      throw new SandboxPortError(`Sandbox port must be an integer from 1 to 65535: ${port}`);
    }
    if (unique.has(port)) {
      throw new SandboxPortError(`Sandbox port is duplicated: ${port}`);
    }
    unique.add(port);
  }
  return [...unique];
}

function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65_535;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertWaitOptions(timeoutMs: number, intervalMs: number): void {
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new SandboxPortError("Port wait timeoutMs must be a positive integer.");
  }
  if (!Number.isInteger(intervalMs) || intervalMs <= 0) {
    throw new SandboxPortError("Port wait intervalMs must be a positive integer.");
  }
}

async function waitWithSignal(timeoutMs: number, signal: AbortSignal | undefined): Promise<void> {
  if (signal?.aborted === true) throw abortReason(signal);
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, timeoutMs);
    const abort = () => {
      clearTimeout(timeout);
      reject(abortReason(signal));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function abortReason(signal: AbortSignal | undefined): unknown {
  return signal?.reason ?? new SandboxPortError("Waiting for sandbox port was aborted.");
}
