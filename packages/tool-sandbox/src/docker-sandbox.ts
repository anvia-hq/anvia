import { randomUUID } from "node:crypto";
import { lstat, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { assertDockerCli, decodeUtf8, runDockerCli } from "./docker-cli";
import { DockerProcessManager } from "./docker-process";
import { DockerSandboxError } from "./errors";
import { containerPath, normalizeSandboxPath, parentSandboxPath } from "./path";
import { createTextFilePage } from "./text-file";
import type {
  CreateDockerSandboxOptions,
  DockerSandbox,
  DockerSandboxClientOptions,
  DockerSandboxExecOptions,
  DockerSandboxExecResult,
  DockerSandboxExecStreamEvent,
  DockerSandboxFileEntry,
  DockerSandboxFileType,
  DockerSandboxInspectionOptions,
  DockerSandboxInspector,
  DockerSandboxListFilesOptions,
  DockerSandboxListProcessesOptions,
  DockerSandboxProcessInfo,
  DockerSandboxProcessLogs,
  DockerSandboxProcessStartOptions,
  DockerSandboxPublishedPort,
  DockerSandboxReadFileOptions,
  DockerSandboxReadProcessLogsOptions,
  DockerSandboxReadTextFilePageOptions,
  DockerSandboxRuntime,
  DockerSandboxRuntimeLimits,
  DockerSandboxState,
  DockerSandboxStopProcessOptions,
  DockerSandboxTextFilePage,
  DockerSandboxWaitForPortOptions,
  DockerSandboxWorkspace,
  DockerSandboxWriteFileOptions,
  DockerSandboxWriteTextFileOptions,
  PullDockerImageOptions,
  ResumeDockerSandboxOptions,
} from "./types";

const schemaVersion = "1";
const labelPrefix = "anvia.sandbox.";
const defaultWorkdir = "/workspace";
const defaultCommandTimeoutMs = 30_000;
const defaultMaxOutputBytes = 1024 * 1024;
const defaultMaxFileBytes = 10 * 1024 * 1024;
const defaultMaxProcesses = 4;
const defaultTextFilePageLines = 500;
const defaultTextFilePageBytes = 64 * 1024;
const defaultPortWaitTimeoutMs = 30_000;
const defaultPortWaitIntervalMs = 100;
const idPattern = /^[a-z0-9](?:[a-z0-9_.-]{0,62})$/;
const envKeyPattern = /^[A-Za-z_][A-Za-z0-9_]*$/;

const labels = {
  schema: `${labelPrefix}schema`,
  id: `${labelPrefix}id`,
  workdir: `${labelPrefix}workdir`,
  workspaceType: `${labelPrefix}workspace.type`,
  workspaceVolume: `${labelPrefix}workspace.volume`,
  networkMode: `${labelPrefix}network.mode`,
  commandTimeoutMs: `${labelPrefix}runtime.command-timeout-ms`,
  maxOutputBytes: `${labelPrefix}runtime.max-output-bytes`,
  maxFileBytes: `${labelPrefix}runtime.max-file-bytes`,
  maxProcesses: `${labelPrefix}runtime.max-processes`,
} as const;

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

type ResolvedRuntimeLimits = Required<DockerSandboxRuntimeLimits>;

type SandboxConfiguration = {
  id: string;
  containerName: string;
  workdir: string;
  workspace: DockerSandboxWorkspace;
  volumeName: string;
  ownsVolume: boolean;
  env: Record<string, string>;
  runtime: ResolvedRuntimeLimits;
  publishedPorts: DockerSandboxPublishedPort[];
};

export class DockerSandboxClient {
  private readonly dockerPath: string;

  constructor(options: DockerSandboxClientOptions = {}) {
    if (!isRecord(options)) throw new TypeError("options must be an object.");
    this.dockerPath = options.dockerPath ?? "docker";
    assertNonEmptyString(this.dockerPath, "dockerPath");
  }

  async pullImage(options: PullDockerImageOptions): Promise<void> {
    if (!isRecord(options)) throw new TypeError("options must be an object.");
    assertNonEmptyString(options.image, "image");
    options.abortSignal?.throwIfAborted();
    await assertDockerCli(["pull", options.image], this.cliOptions(options.abortSignal));
  }

  async createSandbox(options: CreateDockerSandboxOptions): Promise<DockerSandbox> {
    validateCreateOptions(options);
    options = snapshotCreateOptions(options);
    options.abortSignal?.throwIfAborted();

    const id = options.id ?? randomUUID();
    assertSandboxId(id);
    const containerName = containerNameFor(id);
    const workdir = options.workdir ?? defaultWorkdir;
    const runtime = resolveRuntimeLimits(options.runtime);
    const workspace = copyWorkspace(options.workspace);
    const network = copyNetwork(options.network);
    const env = copyStringRecord(options.env, "env");
    const userLabels = copyStringRecord(options.labels, "labels");
    const volumeName =
      workspace.type === "ephemeral"
        ? `${containerName}-workspace-${randomUUID()}`
        : workspace.name;
    const ownsVolume = workspace.type === "ephemeral";

    await this.assertContainerDoesNotExist(containerName, options.abortSignal);
    await this.assertImageExists(options.image, options.abortSignal);
    if (workspace.type === "docker-volume") {
      await this.assertVolumeExists(workspace.name, options.abortSignal);
    }

    let containerCreated = false;
    let volumeCreated = false;
    try {
      if (workspace.type === "ephemeral") {
        await assertDockerCli(
          ["volume", "create", "--label", `${labels.id}=${id}`, volumeName],
          this.cliOptions(options.abortSignal),
        );
        volumeCreated = true;
      }
      await assertDockerCli(
        createRunArgs({
          id,
          containerName,
          image: options.image,
          workdir,
          workspace,
          volumeName,
          env,
          user: options.user,
          userLabels,
          resources: options.resources,
          runtime,
          security: options.security,
          network,
        }),
        {
          ...this.cliOptions(options.abortSignal),
          timeoutMs: runtime.commandTimeoutMs,
        },
      );
      containerCreated = true;

      const publishedPorts = await inspectPublishedPorts({
        dockerPath: this.dockerPath,
        containerName,
        ports: network.mode === "bridge" ? [...(network.ports ?? [])] : [],
        abortSignal: options.abortSignal,
      });
      const sandbox = this.createHandle({
        id,
        containerName,
        workdir,
        workspace,
        volumeName,
        ownsVolume,
        env,
        runtime,
        publishedPorts,
      });
      await applyInitialContent(sandbox.runtime, options);
      return sandbox;
    } catch (error) {
      const cleanupErrors: unknown[] = [];
      if (containerCreated) {
        try {
          await removeContainer(this.dockerPath, containerName);
        } catch (cleanupError) {
          cleanupErrors.push(cleanupError);
        }
      }
      if (ownsVolume && volumeCreated) {
        try {
          await removeVolume(this.dockerPath, volumeName);
        } catch (cleanupError) {
          cleanupErrors.push(cleanupError);
        }
      }
      if (cleanupErrors.length > 0) {
        throw new AggregateError([error, ...cleanupErrors], "Sandbox creation and rollback failed");
      }
      throw error;
    }
  }

  async resumeSandbox(options: ResumeDockerSandboxOptions): Promise<DockerSandbox> {
    if (!isRecord(options)) throw new TypeError("options must be an object.");
    assertSandboxId(options.id);
    options.abortSignal?.throwIfAborted();
    const containerName = containerNameFor(options.id);
    const inspection = await inspectContainer(
      this.dockerPath,
      containerName,
      options.abortSignal,
      true,
    );
    const configuration = configurationFromInspection(options.id, containerName, inspection);

    if (inspection.State.Paused === true || inspection.State.Dead === true) {
      throw new DockerSandboxError(
        `Sandbox cannot be resumed from Docker state: ${inspection.State.Status ?? "unknown"}`,
        "invalid_state",
      );
    }
    if (inspection.State.Running === true) {
      await assertDockerCli(["stop", containerName], this.cliOptions(options.abortSignal));
    }
    await assertDockerCli(["start", containerName], this.cliOptions(options.abortSignal));
    configuration.publishedPorts = await inspectPublishedPorts({
      dockerPath: this.dockerPath,
      containerName,
      ports: configuredContainerPorts(inspection),
      abortSignal: options.abortSignal,
    });
    return this.createHandle(configuration);
  }

  private createHandle(configuration: SandboxConfiguration): DockerSandbox {
    return new DockerSandboxHandle({
      dockerPath: this.dockerPath,
      configuration,
    });
  }

  private async assertImageExists(image: string, abortSignal?: AbortSignal): Promise<void> {
    const result = await runDockerCli(["image", "inspect", image], this.cliOptions(abortSignal));
    if (result.exitCode === 0) return;
    const message = safeDecode(result.stderr);
    if (message.toLowerCase().includes("no such image")) {
      throw new DockerSandboxError(
        `Docker image is not available locally: ${image}`,
        "image_not_found",
      );
    }
    throw new DockerSandboxError(
      "Unable to inspect Docker image.",
      "docker_command_failed",
      result,
    );
  }

  private async assertContainerDoesNotExist(
    containerName: string,
    abortSignal?: AbortSignal,
  ): Promise<void> {
    const result = await runDockerCli(["container", "inspect", containerName], {
      ...this.cliOptions(abortSignal),
      maxOutputBytes: defaultMaxOutputBytes,
    });
    if (result.exitCode === 0) {
      throw new DockerSandboxError(
        `A Docker container already exists for sandbox: ${containerName}`,
        "invalid_state",
      );
    }
    if (safeDecode(result.stderr).toLowerCase().includes("no such")) return;
    throw new DockerSandboxError(
      "Unable to check whether the Docker sandbox already exists.",
      "docker_command_failed",
      result,
    );
  }

  private async assertVolumeExists(name: string, abortSignal?: AbortSignal): Promise<void> {
    const result = await runDockerCli(["volume", "inspect", name], this.cliOptions(abortSignal));
    if (result.exitCode === 0) return;
    const message = safeDecode(result.stderr);
    if (message.toLowerCase().includes("no such volume")) {
      throw new DockerSandboxError(`Docker volume does not exist: ${name}`, "volume_not_found");
    }
    throw new DockerSandboxError(
      "Unable to inspect Docker volume.",
      "docker_command_failed",
      result,
    );
  }

  private cliOptions(abortSignal?: AbortSignal) {
    return { dockerPath: this.dockerPath, signal: abortSignal };
  }
}

class DockerSandboxHandle implements DockerSandbox {
  readonly id: string;
  readonly runtime: DockerSandboxRuntime;

  private currentState: DockerSandboxState = "running";
  private readonly dockerPath: string;
  private readonly configuration: SandboxConfiguration;
  private readonly runtimeImpl: DockerSandboxRuntimeImpl;
  private stopPromise: Promise<void> | undefined;
  private destroyPromise: Promise<void> | undefined;

  constructor(options: { dockerPath: string; configuration: SandboxConfiguration }) {
    this.dockerPath = options.dockerPath;
    this.configuration = options.configuration;
    this.id = options.configuration.id;
    this.runtimeImpl = new DockerSandboxRuntimeImpl({
      configuration: options.configuration,
      dockerPath: options.dockerPath,
      state: () => this.currentState,
    });
    this.runtime = Object.freeze(this.runtimeImpl.publicRuntime());
  }

  get state(): DockerSandboxState {
    return this.currentState;
  }

  inspector(options: DockerSandboxInspectionOptions): DockerSandboxInspector {
    if (!isRecord(options)) throw new TypeError("options must be an object.");
    if (options.files !== true && options.ports !== true && options.processes !== true) {
      throw new TypeError("Sandbox inspector must enable at least one capability.");
    }
    let inspector: DockerSandboxInspector = {
      id: this.id,
      provider: "docker",
      workdir: this.configuration.workdir,
    };
    if (options.files === true) {
      inspector = {
        ...inspector,
        listFiles: this.runtime.listFiles.bind(this.runtime),
        readFile: this.runtime.readFile.bind(this.runtime),
      };
    }
    if (options.ports === true) {
      inspector = { ...inspector, publishedPorts: this.runtime.publishedPorts };
    }
    if (options.processes === true) {
      inspector = {
        ...inspector,
        listProcesses: this.runtime.listProcesses.bind(this.runtime),
        readProcessLogs: this.runtime.readProcessLogs.bind(this.runtime),
      };
    }
    return Object.freeze(inspector);
  }

  async stop(options: Readonly<{ abortSignal?: AbortSignal }> = {}): Promise<void> {
    if (!isRecord(options)) throw new TypeError("options must be an object.");
    if (this.currentState === "stopped") return;
    if (this.currentState === "destroyed" || this.currentState === "destroying") {
      throw invalidState(this.id, this.currentState);
    }
    if (this.stopPromise !== undefined) return this.stopPromise;
    this.stopPromise = this.performStop(options.abortSignal);
    try {
      await this.stopPromise;
    } finally {
      this.stopPromise = undefined;
    }
  }

  private async performStop(abortSignal?: AbortSignal): Promise<void> {
    abortSignal?.throwIfAborted();
    this.currentState = "stopping";
    try {
      await this.runtimeImpl.closeActiveOperations("Sandbox is stopping.");
      await this.runtimeImpl.disposeProcesses(abortSignal);
      await assertDockerCli(["stop", this.configuration.containerName], {
        dockerPath: this.dockerPath,
        signal: abortSignal,
      });
      this.currentState = "stopped";
    } catch (error) {
      this.currentState = "error";
      throw error;
    }
  }

  async destroy(): Promise<void> {
    if (this.currentState === "destroyed") return;
    if (this.destroyPromise !== undefined) return this.destroyPromise;
    this.destroyPromise = this.performDestroy();
    try {
      await this.destroyPromise;
    } finally {
      this.destroyPromise = undefined;
    }
  }

  private async performDestroy(): Promise<void> {
    if (this.stopPromise !== undefined) await this.stopPromise.catch(() => undefined);
    this.currentState = "destroying";
    const failures: unknown[] = [];
    try {
      await this.runtimeImpl.closeActiveOperations("Sandbox is being destroyed.");
    } catch (error) {
      failures.push(error);
    }
    try {
      await this.runtimeImpl.disposeProcesses();
    } catch (error) {
      failures.push(error);
    }
    try {
      await removeContainer(this.dockerPath, this.configuration.containerName);
    } catch (error) {
      failures.push(error);
    }
    if (this.configuration.ownsVolume) {
      try {
        await removeVolume(this.dockerPath, this.configuration.volumeName);
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) {
      this.currentState = "error";
      throw new AggregateError(failures, `Unable to destroy sandbox: ${this.id}`);
    }
    this.currentState = "destroyed";
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.destroy();
  }
}

class DockerSandboxRuntimeImpl {
  private readonly configuration: SandboxConfiguration;
  private readonly dockerPath: string;
  private readonly state: () => DockerSandboxState;
  private readonly processManager: DockerProcessManager;
  private readonly activeControllers = new Set<AbortController>();
  private readonly activeOperations = new Set<Promise<unknown>>();
  private processDisposed = false;

  constructor(options: {
    configuration: SandboxConfiguration;
    dockerPath: string;
    state: () => DockerSandboxState;
  }) {
    this.configuration = options.configuration;
    this.dockerPath = options.dockerPath;
    this.state = options.state;
    this.processManager = new DockerProcessManager({
      containerName: options.configuration.containerName,
      dockerPath: options.dockerPath,
      workdir: options.configuration.workdir,
      env: options.configuration.env,
      maxOutputBytes: options.configuration.runtime.maxOutputBytes,
      maxProcesses: options.configuration.runtime.maxProcesses,
      startupTimeoutMs: options.configuration.runtime.commandTimeoutMs,
    });
  }

  publicRuntime(): DockerSandboxRuntime {
    return {
      id: this.configuration.id,
      provider: "docker",
      workdir: this.configuration.workdir,
      publishedPorts: Object.freeze(
        this.configuration.publishedPorts.map((port) => Object.freeze({ ...port })),
      ),
      exec: (options) => this.exec(options),
      execStream: (options) => this.execStream(options),
      readFile: (options) => this.readFile(options),
      readTextFile: (options) => this.readTextFile(options),
      readTextFilePage: (options) => this.readTextFilePage(options),
      writeFile: (options) => this.writeFile(options),
      writeTextFile: (options) => this.writeTextFile(options),
      listFiles: (options) => this.listFiles(options),
      startProcess: (options) => this.startProcess(options),
      listProcesses: (options) => this.listProcesses(options),
      readProcessLogs: (options) => this.readProcessLogs(options),
      stopProcess: (options) => this.stopProcess(options),
      waitForPort: (options) => this.waitForPort(options),
    };
  }

  async exec(options: DockerSandboxExecOptions): Promise<DockerSandboxExecResult> {
    validateExecOptions(options);
    return this.runOperation(options.abortSignal, async (abortSignal) => {
      const result = await runDockerCli(this.execArgs(options), {
        dockerPath: this.dockerPath,
        timeoutMs: options.timeoutMs ?? this.configuration.runtime.commandTimeoutMs,
        maxOutputBytes: this.configuration.runtime.maxOutputBytes,
        input: options.input,
        signal: abortSignal,
      });
      return toExecResult(result);
    });
  }

  async *execStream(
    options: DockerSandboxExecOptions,
  ): AsyncIterable<DockerSandboxExecStreamEvent> {
    validateExecOptions(options);
    this.assertRunning();
    const streamAbort = new AbortController();
    const combined = combineSignals(options.abortSignal, streamAbort.signal);
    const queue: DockerSandboxExecStreamEvent[] = [];
    let queuedBytes = 0;
    let wake: (() => void) | undefined;
    let complete = false;
    let failure: unknown;
    const push = (event: DockerSandboxExecStreamEvent) => {
      if (event.type !== "result") {
        queuedBytes += event.data.byteLength;
        if (queuedBytes > this.configuration.runtime.maxOutputBytes) {
          streamAbort.abort(
            new DockerSandboxError("Sandbox stream consumer is too slow.", "docker_command_failed"),
          );
          return;
        }
      }
      queue.push(event);
      wake?.();
      wake = undefined;
    };
    const run = this.runOperation(combined, async (abortSignal) => {
      const result = await runDockerCli(this.execArgs(options), {
        dockerPath: this.dockerPath,
        timeoutMs: options.timeoutMs ?? this.configuration.runtime.commandTimeoutMs,
        maxOutputBytes: this.configuration.runtime.maxOutputBytes,
        input: options.input,
        signal: abortSignal,
        onStdout: (data) => push({ type: "stdout", data: data.slice() }),
        onStderr: (data) => push({ type: "stderr", data: data.slice() }),
      });
      push({ type: "result", result: toExecResult(result) });
    });
    void run.then(
      () => {
        complete = true;
        wake?.();
      },
      (error) => {
        failure = error;
        complete = true;
        wake?.();
      },
    );

    try {
      while (!complete || queue.length > 0) {
        const event = queue.shift();
        if (event !== undefined) {
          if (event.type !== "result") queuedBytes -= event.data.byteLength;
          yield event;
          continue;
        }
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
      if (failure !== undefined) throw failure;
    } finally {
      if (!complete) streamAbort.abort(new DOMException("Stream closed", "AbortError"));
      await run.catch(() => undefined);
    }
  }

  async readFile(options: DockerSandboxReadFileOptions): Promise<Uint8Array> {
    assertReadOptions(options);
    return this.runOperation(options.abortSignal, async (abortSignal) => {
      const normalized = normalizeSandboxPath(options.path);
      const tempDir = await mkdtemp(path.join(os.tmpdir(), "anvia-sandbox-read-"));
      const target = path.join(tempDir, path.basename(normalized));
      try {
        await assertDockerCli(
          [
            "cp",
            `${this.configuration.containerName}:${containerPath(this.configuration.workdir, normalized)}`,
            target,
          ],
          { dockerPath: this.dockerPath, signal: abortSignal },
        );
        await assertCopiedRegularFile(tempDir, target, normalized);
        const bytes = await readFile(target, { signal: abortSignal });
        this.assertFileSize(bytes.byteLength, normalized);
        return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength).slice();
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    });
  }

  async readTextFile(options: DockerSandboxReadFileOptions): Promise<string> {
    return decodeUtf8(await this.readFile(options));
  }

  async readTextFilePage(
    options: DockerSandboxReadTextFilePageOptions,
  ): Promise<DockerSandboxTextFilePage> {
    assertReadOptions(options);
    const startLine = options.startLine ?? 1;
    const lineCount = options.lineCount ?? defaultTextFilePageLines;
    const maxBytes = options.maxBytes ?? defaultTextFilePageBytes;
    assertPositiveSafeInteger(startLine, "startLine");
    assertPositiveSafeInteger(lineCount, "lineCount");
    assertPositiveSafeInteger(maxBytes, "maxBytes");
    let readOptions: DockerSandboxReadFileOptions = {
      path: options.path,
    };
    if (options.abortSignal !== undefined) {
      readOptions = { ...readOptions, abortSignal: options.abortSignal };
    }
    const text = await this.readTextFile(readOptions);
    return createTextFilePage(text, { startLine, lineCount, maxBytes });
  }

  async writeFile(options: DockerSandboxWriteFileOptions): Promise<void> {
    assertOptionsObject(options);
    if (!(options.data instanceof Uint8Array)) throw new TypeError("data must be a Uint8Array.");
    const data = options.data.slice();
    await this.writeBytes(options.path, data, options.abortSignal);
  }

  async writeTextFile(options: DockerSandboxWriteTextFileOptions): Promise<void> {
    assertOptionsObject(options);
    if (typeof options.text !== "string") throw new TypeError("text must be a string.");
    await this.writeBytes(
      options.path,
      new TextEncoder().encode(options.text),
      options.abortSignal,
    );
  }

  private async writeBytes(
    filePath: string,
    data: Uint8Array,
    abortSignal?: AbortSignal,
  ): Promise<void> {
    const normalized = normalizeSandboxPath(filePath);
    this.assertFileSize(data.byteLength, normalized);
    await this.runOperation(abortSignal, async (effectiveSignal) => {
      await this.mkdir(parentSandboxPath(normalized), effectiveSignal);
      const tempDir = await mkdtemp(path.join(os.tmpdir(), "anvia-sandbox-write-"));
      const source = path.join(tempDir, path.basename(normalized));
      try {
        await writeFile(source, data, { signal: effectiveSignal });
        await assertDockerCli(
          [
            "cp",
            source,
            `${this.configuration.containerName}:${containerPath(this.configuration.workdir, normalized)}`,
          ],
          { dockerPath: this.dockerPath, signal: effectiveSignal },
        );
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    });
  }

  async listFiles(
    options: DockerSandboxListFilesOptions = {},
  ): Promise<readonly DockerSandboxFileEntry[]> {
    assertOptionsObject(options);
    const requestedPath = options.path ?? ".";
    const normalized = normalizeSandboxPath(requestedPath, { allowRoot: true });
    return this.runOperation(options.abortSignal, async (abortSignal) => {
      const result = await this.execCommand(
        {
          command: "find",
          args: [
            containerPath(this.configuration.workdir, normalized),
            "-mindepth",
            "1",
            "-maxdepth",
            "1",
            "-printf",
            "%p\t%y\t%s\n",
          ],
        },
        abortSignal,
      );
      if (result.status !== "exited" || result.exitCode !== 0) {
        throw new DockerSandboxError(
          "Unable to list sandbox files.",
          "docker_command_failed",
          result,
        );
      }
      const output = decodeUtf8(result.stdout);
      return output
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => parseFindEntry(line, this.configuration.workdir));
    });
  }

  async startProcess(options: DockerSandboxProcessStartOptions): Promise<DockerSandboxProcessInfo> {
    validateProcessStartOptions(options);
    return this.runOperation(options.abortSignal, async (abortSignal) =>
      this.processManager.start({ ...options, abortSignal }),
    );
  }

  async listProcesses(
    options: DockerSandboxListProcessesOptions = {},
  ): Promise<readonly DockerSandboxProcessInfo[]> {
    assertOptionsObject(options);
    return this.runOperation(options.abortSignal, async () => this.processManager.list());
  }

  async readProcessLogs(
    options: DockerSandboxReadProcessLogsOptions,
  ): Promise<DockerSandboxProcessLogs> {
    assertOptionsObject(options);
    assertNonEmptyString(options.processId, "processId");
    if (options.tailBytes !== undefined)
      assertNonNegativeSafeInteger(options.tailBytes, "tailBytes");
    return this.runOperation(options.abortSignal, async () =>
      this.processManager.logs(options.processId, options.tailBytes),
    );
  }

  async stopProcess(options: DockerSandboxStopProcessOptions): Promise<DockerSandboxProcessInfo> {
    assertOptionsObject(options);
    assertNonEmptyString(options.processId, "processId");
    if (options.gracePeriodMs !== undefined) {
      assertNonNegativeSafeInteger(options.gracePeriodMs, "gracePeriodMs");
    }
    return this.runOperation(options.abortSignal, async (abortSignal) =>
      this.processManager.stop(options.processId, options.gracePeriodMs, abortSignal),
    );
  }

  async waitForPort(options: DockerSandboxWaitForPortOptions): Promise<DockerSandboxPublishedPort> {
    assertOptionsObject(options);
    assertPort(options.containerPort);
    const publishedPort = this.configuration.publishedPorts.find(
      (candidate) => candidate.containerPort === options.containerPort,
    );
    if (publishedPort === undefined) {
      throw new DockerSandboxError(
        `Sandbox port is not published: ${options.containerPort}/tcp`,
        "port",
      );
    }
    const timeoutMs = options.timeoutMs ?? defaultPortWaitTimeoutMs;
    const intervalMs = options.intervalMs ?? defaultPortWaitIntervalMs;
    assertPositiveSafeInteger(timeoutMs, "timeoutMs");
    assertPositiveSafeInteger(intervalMs, "intervalMs");

    return this.runOperation(options.abortSignal, async (abortSignal) => {
      const deadline = Date.now() + timeoutMs;
      while (true) {
        const result = await this.execCommand(
          {
            command: "sh",
            args: ["-c", portProbeScript, "anvia-port-probe", `${options.containerPort}`],
            timeoutMs: Math.min(5_000, timeoutMs),
          },
          abortSignal,
        );
        if (result.status === "exited" && result.exitCode === 0) return { ...publishedPort };
        if (Date.now() >= deadline) {
          throw new DockerSandboxError(
            `Waiting for sandbox port timed out: ${options.containerPort}`,
            "timeout",
          );
        }
        await waitWithSignal(Math.min(intervalMs, deadline - Date.now()), abortSignal);
      }
    });
  }

  async closeActiveOperations(message: string): Promise<void> {
    const reason = new DockerSandboxError(message, "invalid_state");
    for (const controller of this.activeControllers) controller.abort(reason);
    await Promise.allSettled(this.activeOperations);
  }

  async disposeProcesses(abortSignal?: AbortSignal): Promise<void> {
    if (this.processDisposed) return;
    await this.processManager.dispose(abortSignal);
    this.processDisposed = true;
  }

  private async runOperation<T>(
    abortSignal: AbortSignal | undefined,
    operation: (abortSignal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    this.assertRunning();
    abortSignal?.throwIfAborted();
    const controller = new AbortController();
    const effectiveSignal = combineSignals(abortSignal, controller.signal);
    const execution = operation(effectiveSignal);
    this.activeControllers.add(controller);
    this.activeOperations.add(execution);
    try {
      return await execution;
    } finally {
      this.activeControllers.delete(controller);
      this.activeOperations.delete(execution);
    }
  }

  private assertRunning(): void {
    const current = this.state();
    if (current !== "running") throw invalidState(this.configuration.id, current);
  }

  private execArgs(options: DockerSandboxExecOptions): string[] {
    const args = ["exec"];
    if (options.input !== undefined) args.push("-i");
    args.push("-w", containerPath(this.configuration.workdir, options.cwd ?? "."));
    for (const [key, value] of Object.entries(options.env ?? {}))
      args.push("-e", `${key}=${value}`);
    args.push(this.configuration.containerName, options.command, ...(options.args ?? []));
    return args;
  }

  private async execCommand(
    options: Omit<DockerSandboxExecOptions, "abortSignal">,
    abortSignal: AbortSignal,
  ): Promise<DockerSandboxExecResult> {
    const result = await runDockerCli(this.execArgs(options), {
      dockerPath: this.dockerPath,
      timeoutMs: options.timeoutMs ?? this.configuration.runtime.commandTimeoutMs,
      maxOutputBytes: this.configuration.runtime.maxOutputBytes,
      input: options.input,
      signal: abortSignal,
    });
    return toExecResult(result);
  }

  private async mkdir(directory: string, abortSignal: AbortSignal): Promise<void> {
    if (directory === ".") return;
    const result = await this.execCommand(
      { command: "mkdir", args: ["-p", containerPath(this.configuration.workdir, directory)] },
      abortSignal,
    );
    if (result.status !== "exited" || result.exitCode !== 0) {
      throw new DockerSandboxError(
        "Unable to create sandbox directory.",
        "docker_command_failed",
        result,
      );
    }
  }

  private assertFileSize(size: number, filePath: string): void {
    if (size > this.configuration.runtime.maxFileBytes) {
      throw new DockerSandboxError(
        `Sandbox file exceeds maxFileBytes (${size} > ${this.configuration.runtime.maxFileBytes}): ${filePath}`,
        "file_too_large",
      );
    }
  }
}

async function applyInitialContent(
  runtime: DockerSandboxRuntime,
  options: CreateDockerSandboxOptions,
): Promise<void> {
  for (const directory of options.directories ?? []) {
    const marker = path.posix.join(normalizeSandboxPath(directory), ".anvia-keep");
    const abort = options.abortSignal === undefined ? {} : { abortSignal: options.abortSignal };
    await runtime.writeFile({ path: marker, data: new Uint8Array(), ...abort });
    const removed = await runtime.exec({ command: "rm", args: [marker], ...abort });
    if (removed.status !== "exited" || removed.exitCode !== 0) {
      throw new DockerSandboxError(
        `Unable to create initial sandbox directory: ${directory}`,
        "docker_command_failed",
        removed,
      );
    }
  }
  for (const [filePath, content] of Object.entries(options.files ?? {})) {
    if (typeof content === "string") {
      let writeOptions: DockerSandboxWriteTextFileOptions = {
        path: filePath,
        text: content,
      };
      if (options.abortSignal !== undefined) {
        writeOptions = { ...writeOptions, abortSignal: options.abortSignal };
      }
      await runtime.writeTextFile(writeOptions);
    } else {
      let writeOptions: DockerSandboxWriteFileOptions = {
        path: filePath,
        data: content,
      };
      if (options.abortSignal !== undefined) {
        writeOptions = { ...writeOptions, abortSignal: options.abortSignal };
      }
      await runtime.writeFile(writeOptions);
    }
  }
}

function createRunArgs(options: {
  id: string;
  containerName: string;
  image: string;
  workdir: string;
  workspace: DockerSandboxWorkspace;
  volumeName: string;
  env: Record<string, string>;
  user: string | undefined;
  userLabels: Record<string, string>;
  resources: CreateDockerSandboxOptions["resources"] | undefined;
  runtime: ResolvedRuntimeLimits;
  security: CreateDockerSandboxOptions["security"] | undefined;
  network: CreateDockerSandboxOptions["network"];
}): string[] {
  const runtimeLabels: Record<string, string> = {
    [labels.schema]: schemaVersion,
    [labels.id]: options.id,
    [labels.workdir]: options.workdir,
    [labels.workspaceType]: options.workspace.type,
    [labels.workspaceVolume]: options.volumeName,
    [labels.networkMode]: options.network.mode,
    [labels.commandTimeoutMs]: `${options.runtime.commandTimeoutMs}`,
    [labels.maxOutputBytes]: `${options.runtime.maxOutputBytes}`,
    [labels.maxFileBytes]: `${options.runtime.maxFileBytes}`,
    [labels.maxProcesses]: `${options.runtime.maxProcesses}`,
  };
  const args = [
    "run",
    "-d",
    "--name",
    options.containerName,
    "--mount",
    `type=volume,src=${options.volumeName},dst=${options.workdir}`,
    "-w",
    options.workdir,
  ];
  for (const [key, value] of Object.entries({ ...options.userLabels, ...runtimeLabels })) {
    args.push("--label", `${key}=${value}`);
  }
  for (const [key, value] of Object.entries(options.env)) args.push("--env", `${key}=${value}`);
  if (options.user !== undefined) args.push("--user", options.user);
  if (options.network.mode === "none") {
    args.push("--network", "none");
  } else {
    for (const port of options.network.ports ?? [])
      args.push("--publish", `127.0.0.1::${port}/tcp`);
  }
  if (options.resources?.memoryMb !== undefined)
    args.push("--memory", `${options.resources.memoryMb}m`);
  if (options.resources?.cpus !== undefined) args.push("--cpus", `${options.resources.cpus}`);
  if (options.resources?.pidsLimit !== undefined) {
    args.push("--pids-limit", `${options.resources.pidsLimit}`);
  }
  if (options.resources?.sharedMemoryMb !== undefined) {
    args.push("--shm-size", `${options.resources.sharedMemoryMb}m`);
  }
  if (options.security?.readonlyRootfs === true) args.push("--read-only");
  if (options.security?.noNewPrivileges ?? true)
    args.push("--security-opt", "no-new-privileges:true");
  if (options.security?.seccompProfile !== undefined) {
    args.push("--security-opt", `seccomp=${options.security.seccompProfile.path}`);
  }
  for (const capability of options.security?.dropCapabilities ?? ["ALL"]) {
    args.push("--cap-drop", capability);
  }
  for (const capability of options.security?.addCapabilities ?? []) {
    args.push("--cap-add", capability);
  }
  args.push(
    options.image,
    "sh",
    "-c",
    "trap 'exit 0' TERM INT; while :; do sleep 3600 & wait $!; done",
  );
  return args;
}

function validateCreateOptions(options: CreateDockerSandboxOptions): void {
  if (options === null || typeof options !== "object")
    throw new TypeError("options must be an object.");
  assertNonEmptyString(options.image, "image");
  if (options.id !== undefined) assertSandboxId(options.id);
  const workdir = options.workdir ?? defaultWorkdir;
  if (!path.posix.isAbsolute(workdir) || workdir.includes("\0")) {
    throw new TypeError("workdir must be an absolute POSIX path.");
  }
  if (!isRecord(options.workspace)) throw new TypeError("workspace must be an object.");
  if (options.workspace.type === "docker-volume") assertDockerVolumeName(options.workspace.name);
  if (options.workspace.type !== "ephemeral" && options.workspace.type !== "docker-volume") {
    throw new TypeError("workspace must use type ephemeral or docker-volume.");
  }
  if (options.workspace.type === "ephemeral" && "name" in options.workspace) {
    throw new TypeError("An ephemeral workspace cannot specify a Docker volume name.");
  }
  if (!isRecord(options.network)) throw new TypeError("network must be an object.");
  if (options.network.mode !== "none" && options.network.mode !== "bridge") {
    throw new TypeError("network must use mode none or bridge.");
  }
  if (options.network.mode === "none" && "ports" in options.network) {
    throw new TypeError("Network mode none cannot publish ports.");
  }
  if (options.network.mode === "bridge") {
    if (options.network.ports !== undefined && !Array.isArray(options.network.ports)) {
      throw new TypeError("network.ports must be an array.");
    }
    validatePorts(options.network.ports ?? []);
  }
  validateRuntimeLimits(options.runtime);
  validateResources(options.resources);
  validateSecurity(options.security);
  copyStringRecord(options.env, "env");
  const userLabels = copyStringRecord(options.labels, "labels");
  for (const key of Object.keys(userLabels)) {
    if (key.startsWith(labelPrefix)) throw new TypeError(`Docker label is reserved: ${key}`);
  }
  if (options.user !== undefined) assertNonEmptyString(options.user, "user");
  if (options.directories !== undefined && !Array.isArray(options.directories)) {
    throw new TypeError("directories must be an array.");
  }
  for (const directory of options.directories ?? []) {
    if (typeof directory !== "string") throw new TypeError("directories must contain strings.");
    normalizeSandboxPath(directory);
  }
  if (options.files !== undefined && !isRecord(options.files)) {
    throw new TypeError("files must be an object.");
  }
  for (const [filePath, content] of Object.entries(options.files ?? {})) {
    normalizeSandboxPath(filePath);
    if (typeof content !== "string" && !(content instanceof Uint8Array)) {
      throw new TypeError(`Initial file must be a string or Uint8Array: ${filePath}`);
    }
    const byteLength =
      typeof content === "string"
        ? new TextEncoder().encode(content).byteLength
        : content.byteLength;
    const maxFileBytes = options.runtime?.maxFileBytes ?? defaultMaxFileBytes;
    if (byteLength > maxFileBytes) {
      throw new DockerSandboxError(
        `Initial file exceeds maxFileBytes (${byteLength} > ${maxFileBytes}): ${filePath}`,
        "file_too_large",
      );
    }
  }
}

function validateRuntimeLimits(runtime?: DockerSandboxRuntimeLimits): void {
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

function validateResources(resources: CreateDockerSandboxOptions["resources"]): void {
  if (resources !== undefined && !isRecord(resources)) {
    throw new TypeError("resources must be an object.");
  }
  if (resources?.memoryMb !== undefined) assertPositiveSafeInteger(resources.memoryMb, "memoryMb");
  if (resources?.pidsLimit !== undefined)
    assertPositiveSafeInteger(resources.pidsLimit, "pidsLimit");
  if (resources?.sharedMemoryMb !== undefined)
    assertPositiveSafeInteger(resources.sharedMemoryMb, "sharedMemoryMb");
  if (resources?.cpus !== undefined && (!Number.isFinite(resources.cpus) || resources.cpus <= 0)) {
    throw new RangeError("cpus must be a positive finite number.");
  }
}

function validateSecurity(security: CreateDockerSandboxOptions["security"]): void {
  if (security !== undefined && !isRecord(security)) {
    throw new TypeError("security must be an object.");
  }
  if (security?.dropCapabilities !== undefined && !Array.isArray(security.dropCapabilities)) {
    throw new TypeError("dropCapabilities must be an array.");
  }
  if (security?.addCapabilities !== undefined && !Array.isArray(security.addCapabilities)) {
    throw new TypeError("addCapabilities must be an array.");
  }
  if (security?.readonlyRootfs !== undefined && typeof security.readonlyRootfs !== "boolean") {
    throw new TypeError("readonlyRootfs must be a boolean.");
  }
  if (security?.noNewPrivileges !== undefined && typeof security.noNewPrivileges !== "boolean") {
    throw new TypeError("noNewPrivileges must be a boolean.");
  }
  if (security?.seccompProfile !== undefined) {
    if (!isRecord(security.seccompProfile) || security.seccompProfile.type !== "path") {
      throw new TypeError('seccompProfile must be a { type: "path", path } object.');
    }
    assertNonEmptyString(security.seccompProfile.path, "seccompProfile.path");
    if (
      !path.isAbsolute(security.seccompProfile.path) ||
      security.seccompProfile.path.includes("\0")
    ) {
      throw new TypeError("seccompProfile.path must be an absolute host path.");
    }
  }
  const seen = new Set<string>();
  for (const capability of security?.dropCapabilities ?? []) {
    assertNonEmptyString(capability, "dropCapabilities value");
    if (seen.has(capability))
      throw new TypeError(`dropCapabilities contains a duplicate: ${capability}`);
    seen.add(capability);
  }
  seen.clear();
  for (const capability of security?.addCapabilities ?? []) {
    assertNonEmptyString(capability, "addCapabilities value");
    if (seen.has(capability))
      throw new TypeError(`addCapabilities contains a duplicate: ${capability}`);
    seen.add(capability);
  }
}

function validateExecOptions(options: DockerSandboxExecOptions): void {
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

function validateProcessStartOptions(options: DockerSandboxProcessStartOptions): void {
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

function assertReadOptions(options: DockerSandboxReadFileOptions): void {
  assertOptionsObject(options);
  normalizeSandboxPath(options.path);
}

function assertOptionsObject(value: unknown): asserts value is Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError("options must be an object.");
}

function resolveRuntimeLimits(runtime?: DockerSandboxRuntimeLimits): ResolvedRuntimeLimits {
  return {
    commandTimeoutMs: runtime?.commandTimeoutMs ?? defaultCommandTimeoutMs,
    maxOutputBytes: runtime?.maxOutputBytes ?? defaultMaxOutputBytes,
    maxFileBytes: runtime?.maxFileBytes ?? defaultMaxFileBytes,
    maxProcesses: runtime?.maxProcesses ?? defaultMaxProcesses,
  };
}

function snapshotCreateOptions(options: CreateDockerSandboxOptions): CreateDockerSandboxOptions {
  const files: Record<string, string | Uint8Array> = {};
  for (const [filePath, content] of Object.entries(options.files ?? {})) {
    files[filePath] = typeof content === "string" ? content : content.slice();
  }
  const workspace = copyWorkspace(options.workspace);
  const network = copyNetwork(options.network);
  let snapshot: CreateDockerSandboxOptions = {
    image: options.image,
    workspace,
    network,
  };
  if (options.id !== undefined) snapshot = { ...snapshot, id: options.id };
  if (options.workdir !== undefined) snapshot = { ...snapshot, workdir: options.workdir };
  if (options.files !== undefined) snapshot = { ...snapshot, files: Object.freeze(files) };
  if (options.directories !== undefined) {
    snapshot = { ...snapshot, directories: Object.freeze([...options.directories]) };
  }
  if (options.env !== undefined) {
    snapshot = { ...snapshot, env: Object.freeze({ ...options.env }) };
  }
  if (options.user !== undefined) snapshot = { ...snapshot, user: options.user };
  if (options.labels !== undefined) {
    snapshot = { ...snapshot, labels: Object.freeze({ ...options.labels }) };
  }
  if (options.resources !== undefined) {
    snapshot = { ...snapshot, resources: Object.freeze({ ...options.resources }) };
  }
  if (options.runtime !== undefined) {
    snapshot = { ...snapshot, runtime: Object.freeze({ ...options.runtime }) };
  }
  if (options.security !== undefined) {
    let security: NonNullable<CreateDockerSandboxOptions["security"]> = {
      ...options.security,
    };
    if (options.security.seccompProfile !== undefined) {
      security = {
        ...security,
        seccompProfile: Object.freeze({ ...options.security.seccompProfile }),
      };
    }
    if (options.security.dropCapabilities !== undefined) {
      security = {
        ...security,
        dropCapabilities: Object.freeze([...options.security.dropCapabilities]),
      };
    }
    if (options.security.addCapabilities !== undefined) {
      security = {
        ...security,
        addCapabilities: Object.freeze([...options.security.addCapabilities]),
      };
    }
    snapshot = { ...snapshot, security: Object.freeze(security) };
  }
  if (options.abortSignal !== undefined) {
    snapshot = { ...snapshot, abortSignal: options.abortSignal };
  }
  return Object.freeze(snapshot);
}

function configurationFromInspection(
  id: string,
  containerName: string,
  inspection: DockerContainerInspection,
): SandboxConfiguration {
  const containerLabels = inspection.Config.Labels ?? {};
  if (containerLabels[labels.schema] !== schemaVersion || containerLabels[labels.id] !== id) {
    throw new DockerSandboxError(
      `Container is not an Anvia sandbox: ${containerName}`,
      "sandbox_not_found",
    );
  }
  const workdir = requiredLabel(containerLabels, labels.workdir);
  const workspaceType = requiredLabel(containerLabels, labels.workspaceType);
  const volumeName = requiredLabel(containerLabels, labels.workspaceVolume);
  const networkMode = requiredLabel(containerLabels, labels.networkMode);
  if (networkMode !== "none" && networkMode !== "bridge") invalidInspection("network mode");
  const workspace: DockerSandboxWorkspace =
    workspaceType === "ephemeral"
      ? { type: "ephemeral" }
      : workspaceType === "docker-volume"
        ? { type: "docker-volume", name: volumeName }
        : invalidInspection("workspace type");
  const runtime = {
    commandTimeoutMs: parseLabelInteger(containerLabels, labels.commandTimeoutMs, true),
    maxOutputBytes: parseLabelInteger(containerLabels, labels.maxOutputBytes, false),
    maxFileBytes: parseLabelInteger(containerLabels, labels.maxFileBytes, false),
    maxProcesses: parseLabelInteger(containerLabels, labels.maxProcesses, false),
  };
  return {
    id,
    containerName,
    workdir,
    workspace,
    volumeName,
    ownsVolume: workspace.type === "ephemeral",
    env: {},
    runtime,
    publishedPorts: [],
  };
}

type DockerContainerInspection = {
  Config: { Labels?: Record<string, string>; WorkingDir?: string };
  HostConfig?: {
    PortBindings?: Record<string, Array<{ HostIp?: string; HostPort?: string }> | null>;
  };
  State: { Running?: boolean; Paused?: boolean; Dead?: boolean; Status?: string };
  NetworkSettings?: {
    Ports?: Record<string, Array<{ HostIp?: string; HostPort?: string }> | null>;
  };
};

async function inspectContainer(
  dockerPath: string,
  containerName: string,
  abortSignal: AbortSignal | undefined,
  notFoundAsSandboxError: boolean,
): Promise<DockerContainerInspection> {
  const result = await runDockerCli(["container", "inspect", containerName], {
    dockerPath,
    signal: abortSignal,
  });
  if (result.exitCode !== 0) {
    const message = safeDecode(result.stderr);
    if (notFoundAsSandboxError && message.toLowerCase().includes("no such")) {
      throw new DockerSandboxError(`Sandbox does not exist: ${containerName}`, "sandbox_not_found");
    }
    throw new DockerSandboxError(
      "Unable to inspect Docker sandbox.",
      "docker_command_failed",
      result,
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(decodeUtf8(result.stdout));
  } catch (error) {
    throw new DockerSandboxError(
      "Docker returned invalid container metadata.",
      "docker_command_failed",
      undefined,
      { cause: error },
    );
  }
  if (!Array.isArray(value) || value.length !== 1 || !isInspection(value[0])) {
    throw new DockerSandboxError(
      "Docker returned invalid container metadata.",
      "docker_command_failed",
    );
  }
  return value[0];
}

function isInspection(value: unknown): value is DockerContainerInspection {
  return isRecord(value) && isRecord(value.Config) && isRecord(value.State);
}

async function inspectPublishedPorts(options: {
  dockerPath: string;
  containerName: string;
  ports: readonly number[];
  abortSignal?: AbortSignal | undefined;
}): Promise<DockerSandboxPublishedPort[]> {
  if (options.ports.length === 0) return [];
  const inspection = await inspectContainer(
    options.dockerPath,
    options.containerName,
    options.abortSignal,
    false,
  );
  const mappings = inspection.NetworkSettings?.Ports ?? {};
  return options.ports.map((containerPort) => {
    const entries = mappings[`${containerPort}/tcp`];
    const entry = entries?.find((candidate) => candidate.HostIp === "127.0.0.1");
    const hostPort = Number(entry?.HostPort);
    if (!isPort(hostPort)) {
      throw new DockerSandboxError(`Docker did not publish port: ${containerPort}`, "port");
    }
    return { containerPort, host: "127.0.0.1", hostPort, protocol: "tcp" };
  });
}

function configuredContainerPorts(inspection: DockerContainerInspection): number[] {
  return Object.keys(inspection.HostConfig?.PortBindings ?? {}).flatMap((key) => {
    const match = /^(\d+)\/tcp$/.exec(key);
    if (match?.[1] === undefined) return [];
    const value = Number(match[1]);
    return isPort(value) ? [value] : [];
  });
}

async function assertCopiedRegularFile(
  temporaryDirectory: string,
  target: string,
  sandboxPath: string,
): Promise<void> {
  const metadata = await lstat(target);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new DockerSandboxError(
      `Sandbox path is not a regular file: ${sandboxPath}`,
      "invalid_path",
    );
  }
  const resolvedTarget = await realpath(target);
  const relativeTarget = path.relative(temporaryDirectory, resolvedTarget);
  if (
    relativeTarget === "" ||
    relativeTarget === ".." ||
    relativeTarget.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeTarget)
  ) {
    throw new DockerSandboxError(
      `Sandbox file escaped its temporary read boundary: ${sandboxPath}`,
      "invalid_path",
    );
  }
}

async function removeContainer(dockerPath: string, containerName: string): Promise<void> {
  const result = await runDockerCli(["rm", "-f", containerName], { dockerPath });
  if (result.exitCode === 0 || safeDecode(result.stderr).toLowerCase().includes("no such")) return;
  throw new DockerSandboxError("Unable to remove Docker sandbox.", "docker_command_failed", result);
}

async function removeVolume(dockerPath: string, volumeName: string): Promise<void> {
  const result = await runDockerCli(["volume", "rm", volumeName], { dockerPath });
  if (result.exitCode === 0 || safeDecode(result.stderr).toLowerCase().includes("no such")) return;
  throw new DockerSandboxError(
    "Unable to remove Docker sandbox volume.",
    "docker_command_failed",
    result,
  );
}

function parseFindEntry(line: string, workdir: string): DockerSandboxFileEntry {
  const [absolutePath, rawType, rawSize] = line.split("\t");
  if (absolutePath === undefined || rawType === undefined || rawSize === undefined) {
    throw new DockerSandboxError("Docker returned invalid file metadata.", "docker_command_failed");
  }
  const relativePath = path.posix.relative(workdir, absolutePath);
  const size = Number(rawSize);
  const type = mapFindType(rawType);
  let entry: DockerSandboxFileEntry = {
    path: normalizeSandboxPath(relativePath),
    type,
  };
  if (type === "file" && Number.isSafeInteger(size) && size >= 0) {
    entry = { ...entry, size };
  }
  return entry;
}

function mapFindType(value: string): DockerSandboxFileType {
  if (value === "f") return "file";
  if (value === "d") return "directory";
  if (value === "l") return "symlink";
  return "other";
}

function toExecResult(result: Awaited<ReturnType<typeof runDockerCli>>): DockerSandboxExecResult {
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

function copyWorkspace(workspace: DockerSandboxWorkspace): DockerSandboxWorkspace {
  return workspace.type === "ephemeral"
    ? Object.freeze({ type: "ephemeral" })
    : Object.freeze({ type: "docker-volume", name: workspace.name });
}

function copyNetwork(
  network: CreateDockerSandboxOptions["network"],
): CreateDockerSandboxOptions["network"] {
  return network.mode === "none"
    ? Object.freeze({ mode: "none" })
    : Object.freeze({ mode: "bridge", ports: Object.freeze([...(network.ports ?? [])]) });
}

function copyStringRecord(
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

function requiredLabel(containerLabels: Record<string, string>, name: string): string {
  const value = containerLabels[name];
  if (value === undefined || value.length === 0) invalidInspection(name);
  return value;
}

function parseLabelInteger(
  containerLabels: Record<string, string>,
  name: string,
  positive: boolean,
): number {
  const value = Number(requiredLabel(containerLabels, name));
  if (!Number.isSafeInteger(value) || (positive ? value <= 0 : value < 0)) invalidInspection(name);
  return value;
}

function invalidInspection(field: string): never {
  throw new DockerSandboxError(`Sandbox metadata is invalid: ${field}`, "invalid_state");
}

function validatePorts(ports: readonly number[]): void {
  if (!Array.isArray(ports)) throw new TypeError("ports must be an array.");
  const seen = new Set<number>();
  for (const port of ports) {
    assertPort(port);
    if (seen.has(port)) throw new DockerSandboxError(`Sandbox port is duplicated: ${port}`, "port");
    seen.add(port);
  }
}

function assertPort(port: number): void {
  if (!isPort(port))
    throw new DockerSandboxError(
      `Sandbox port must be an integer from 1 to 65535: ${port}`,
      "port",
    );
}

function isPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65_535;
}

function assertSandboxId(id: string): void {
  if (typeof id !== "string" || !idPattern.test(id)) {
    throw new TypeError(
      "Sandbox id must be 1-63 lowercase letters, numbers, dots, underscores, or hyphens.",
    );
  }
}

function assertDockerVolumeName(name: string): void {
  assertNonEmptyString(name, "workspace.name");
  if (name.includes(",") || name.includes("\0"))
    throw new TypeError("workspace.name is not a valid Docker volume name.");
}

function assertNonEmptyString(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0)
    throw new TypeError(`${name} must be a non-empty string.`);
}

function assertPositiveSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new RangeError(`${name} must be a positive safe integer.`);
}

function assertNonNegativeSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new RangeError(`${name} must be a non-negative safe integer.`);
}

function invalidState(id: string, state: DockerSandboxState): DockerSandboxError {
  return new DockerSandboxError(`Sandbox ${id} is not running (${state}).`, "invalid_state", {
    state,
  });
}

function containerNameFor(id: string): string {
  return `anvia-sandbox-${id}`;
}

function combineSignals(first: AbortSignal | undefined, second: AbortSignal): AbortSignal {
  return first === undefined ? second : AbortSignal.any([first, second]);
}

async function waitWithSignal(timeoutMs: number, abortSignal: AbortSignal): Promise<void> {
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

function safeDecode(bytes: Uint8Array): string {
  try {
    return decodeUtf8(bytes);
  } catch {
    return "";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
