import { fileURLToPath } from "node:url";
import type {
  DockerSandbox,
  DockerSandboxClient,
  DockerSandboxInspectionOptions,
  DockerSandboxInspector,
  DockerSandboxPublishedPort,
  DockerSandboxState,
} from "@anvia/sandbox";
import { connectPlaywrightBrowser, type PlaywrightBrowserConnectionImpl } from "./connection";
import { BrowserControlState } from "./control";
import { BrowserError } from "./errors";
import type {
  BrowserConnectOptions,
  BrowserDesktopEndpoint,
  BrowserWaitUntilReadyOptions,
  CreateDockerBrowserOptions,
  DockerBrowser,
  DockerBrowserClientOptions,
  PlaywrightBrowserConnection,
  PullDockerBrowserImageOptions,
  ResumeDockerBrowserOptions,
} from "./types";

const cdpPort = 9222;
const noVncPort = 6080;
const browserSchema = "1";
const defaultSharedMemoryMb = 1024;
const seccompProfilePath = fileURLToPath(
  new URL("../security/seccomp_profile.json", import.meta.url),
);

export class DockerBrowserClient {
  private readonly sandboxClient: DockerSandboxClient;
  private readonly image: string;

  constructor(options: DockerBrowserClientOptions) {
    if (!isRecord(options)) throw new TypeError("options must be an object.");
    if (!isSandboxClient(options.sandboxClient)) {
      throw new TypeError("sandboxClient must be a DockerSandboxClient.");
    }
    assertNonEmptyString(options.image, "image");
    this.sandboxClient = options.sandboxClient;
    this.image = options.image;
  }

  async pullImage(options: PullDockerBrowserImageOptions = {}): Promise<void> {
    assertOptionsObject(options);
    let pullOptions: Parameters<typeof this.sandboxClient.pullImage>[0] = { image: this.image };
    if (options.abortSignal !== undefined) {
      pullOptions = { ...pullOptions, abortSignal: options.abortSignal };
    }
    await this.sandboxClient.pullImage(pullOptions);
  }

  async createBrowser(options: CreateDockerBrowserOptions): Promise<DockerBrowser> {
    validateCreateOptions(options);
    options.abortSignal?.throwIfAborted();
    const resources = {
      ...options.resources,
      sharedMemoryMb: options.resources?.sharedMemoryMb ?? defaultSharedMemoryMb,
    };
    let sandboxOptions: Parameters<typeof this.sandboxClient.createSandbox>[0] = {
      image: this.image,
      workdir: "/workspace",
      workspace: options.workspace,
      network: { mode: "bridge", ports: [cdpPort, noVncPort] },
      user: "pwuser",
      labels: {
        "anvia.browser.schema": browserSchema,
      },
      resources,
      security: {
        noNewPrivileges: true,
        dropCapabilities: ["ALL"],
        addCapabilities: ["SYS_CHROOT"],
        seccompProfile: { type: "path", path: seccompProfilePath },
      },
    };
    if (options.id !== undefined) sandboxOptions = { ...sandboxOptions, id: options.id };
    if (options.runtime !== undefined) {
      sandboxOptions = { ...sandboxOptions, runtime: options.runtime };
    }
    if (options.abortSignal !== undefined) {
      sandboxOptions = { ...sandboxOptions, abortSignal: options.abortSignal };
    }
    const sandbox = await this.sandboxClient.createSandbox(sandboxOptions);

    try {
      await configureBrowser(sandbox, options);
      await startBrowserServices(sandbox, options.abortSignal);
      return new DockerBrowserHandle(sandbox);
    } catch (error) {
      await sandbox.destroy().catch(() => undefined);
      throw new BrowserError("Unable to configure the browser sandbox.", "startup_failed", {
        cause: error,
      });
    }
  }

  async resumeBrowser(options: ResumeDockerBrowserOptions): Promise<DockerBrowser> {
    assertOptionsObject(options);
    assertNonEmptyString(options.id, "id");
    options.abortSignal?.throwIfAborted();
    const sandbox = await this.sandboxClient.resumeSandbox(options);
    try {
      await assertBrowserImage(sandbox, options.abortSignal);
      await startBrowserServices(sandbox, options.abortSignal);
      return new DockerBrowserHandle(sandbox);
    } catch (error) {
      await sandbox.stop().catch(() => undefined);
      throw new BrowserError("Unable to resume browser services.", "startup_failed", {
        cause: error,
      });
    }
  }
}

class DockerBrowserHandle implements DockerBrowser {
  readonly id: string;
  readonly sandbox: DockerSandbox;
  readonly desktop: BrowserDesktopEndpoint;
  private readonly control = new BrowserControlState();
  private readonly connections = new Set<PlaywrightBrowserConnectionImpl>();

  constructor(sandbox: DockerSandbox) {
    this.sandbox = sandbox;
    this.id = sandbox.id;
    this.desktop = Object.freeze({
      protocol: "novnc",
      containerPort: noVncPort,
      control: this.control,
    });
  }

  get state(): DockerSandboxState {
    return this.sandbox.state;
  }

  inspector(options: DockerSandboxInspectionOptions): DockerSandboxInspector {
    return this.sandbox.inspector(options);
  }

  async waitUntilReady(options: BrowserWaitUntilReadyOptions): Promise<void> {
    assertOptionsObject(options);
    assertPositiveSafeInteger(options.timeoutMs, "timeoutMs");
    this.assertRunning();
    const timeout = AbortSignal.timeout(options.timeoutMs);
    const abortSignal =
      options.abortSignal === undefined ? timeout : AbortSignal.any([options.abortSignal, timeout]);
    try {
      await Promise.all([
        this.sandbox.runtime.waitForPort({
          containerPort: cdpPort,
          timeoutMs: options.timeoutMs,
          abortSignal,
        }),
        this.sandbox.runtime.waitForPort({
          containerPort: noVncPort,
          timeoutMs: options.timeoutMs,
          abortSignal,
        }),
      ]);
      await Promise.all([
        assertHttpReady(`${endpointFor(this.sandbox, cdpPort)}/json/version`, abortSignal),
        assertHttpReady(`${endpointFor(this.sandbox, noVncPort)}/vnc.html`, abortSignal),
      ]);
    } catch (error) {
      if (options.abortSignal?.aborted) options.abortSignal.throwIfAborted();
      throw new BrowserError("Browser did not become ready before the timeout.", "not_ready", {
        cause: error,
      });
    }
  }

  async connect(options: BrowserConnectOptions = {}): Promise<PlaywrightBrowserConnection> {
    assertOptionsObject(options);
    this.assertRunning();
    try {
      let connectOptions: Parameters<typeof connectPlaywrightBrowser>[0] = {
        endpointUrl: endpointFor(this.sandbox, cdpPort),
        control: this.control,
      };
      if (options.abortSignal !== undefined) {
        connectOptions = { ...connectOptions, abortSignal: options.abortSignal };
      }
      const connection = await connectPlaywrightBrowser(connectOptions);
      this.connections.add(connection);
      return connection;
    } catch (error) {
      if (options.abortSignal?.aborted) options.abortSignal.throwIfAborted();
      throw new BrowserError("Unable to connect to Chromium over CDP.", "not_ready", {
        cause: error,
      });
    }
  }

  async stop(options: Readonly<{ abortSignal?: AbortSignal }> = {}): Promise<void> {
    assertOptionsObject(options);
    await this.disconnectAll();
    await this.sandbox.stop(options);
  }

  async destroy(): Promise<void> {
    this.control.destroy();
    await this.disconnectAll();
    await this.sandbox.destroy();
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.destroy();
  }

  private assertRunning(): void {
    if (this.state !== "running") {
      throw new BrowserError(`Browser is not running: ${this.state}`, "invalid_state");
    }
  }

  private async disconnectAll(): Promise<void> {
    const connections = [...this.connections];
    this.connections.clear();
    const results = await Promise.allSettled(
      connections.map((connection) => connection.disconnect()),
    );
    const failures = results
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => result.reason);
    if (failures.length > 0) {
      throw new AggregateError(failures, "Unable to disconnect browser automation clients.");
    }
  }
}

async function configureBrowser(
  sandbox: DockerSandbox,
  options: CreateDockerBrowserOptions,
): Promise<void> {
  let execOptions: Parameters<typeof sandbox.runtime.exec>[0] = {
    command: "/usr/local/bin/anvia-browser-configure",
    input: JSON.stringify({
      password: options.desktop.password,
      width: options.desktop.viewport.width,
      height: options.desktop.viewport.height,
    }),
  };
  if (options.abortSignal !== undefined) {
    execOptions = { ...execOptions, abortSignal: options.abortSignal };
  }
  const result = await sandbox.runtime.exec(execOptions);
  if (result.status !== "exited" || result.exitCode !== 0) {
    throw new Error("Browser image rejected its runtime configuration.");
  }
}

async function assertBrowserImage(
  sandbox: DockerSandbox,
  abortSignal?: AbortSignal,
): Promise<void> {
  let execOptions: Parameters<typeof sandbox.runtime.exec>[0] = {
    command: "/usr/local/bin/anvia-browser-version",
  };
  if (abortSignal !== undefined) execOptions = { ...execOptions, abortSignal };
  const result = await sandbox.runtime.exec(execOptions);
  if (
    result.status !== "exited" ||
    result.exitCode !== 0 ||
    new TextDecoder("utf-8", { fatal: true }).decode(result.stdout).trim() !== browserSchema
  ) {
    throw new Error("Sandbox does not contain a compatible Anvia browser image.");
  }
}

async function startBrowserServices(
  sandbox: DockerSandbox,
  abortSignal?: AbortSignal,
): Promise<void> {
  let startOptions: Parameters<typeof sandbox.runtime.startProcess>[0] = {
    command: "/usr/local/bin/anvia-browser-start",
  };
  if (abortSignal !== undefined) startOptions = { ...startOptions, abortSignal };
  await sandbox.runtime.startProcess(startOptions);
}

async function assertHttpReady(url: string, abortSignal: AbortSignal): Promise<void> {
  while (true) {
    abortSignal.throwIfAborted();
    try {
      const response = await fetch(url, { signal: abortSignal, redirect: "error" });
      if (response.ok) {
        await response.body?.cancel();
        return;
      }
      await response.body?.cancel();
    } catch (error) {
      if (abortSignal.aborted) throw abortSignal.reason ?? error;
    }
    await waitForRetry(abortSignal);
  }
}

async function waitForRetry(abortSignal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(finish, 50);
    const abort = () => finish(abortSignal.reason ?? new DOMException("Aborted", "AbortError"));
    abortSignal.addEventListener("abort", abort, { once: true });

    function finish(error?: unknown): void {
      clearTimeout(timeout);
      abortSignal.removeEventListener("abort", abort);
      if (error === undefined) resolve();
      else reject(error);
    }
  });
}

function endpointFor(sandbox: DockerSandbox, containerPort: number): string {
  const published = publishedPort(sandbox, containerPort);
  return `http://${hostForUrl(published.host)}:${published.hostPort}`;
}

function publishedPort(sandbox: DockerSandbox, containerPort: number): DockerSandboxPublishedPort {
  const port = sandbox.runtime.publishedPorts.find(
    (candidate) => candidate.containerPort === containerPort && candidate.protocol === "tcp",
  );
  if (port === undefined) {
    throw new BrowserError(`Browser port is not published: ${containerPort}`, "invalid_state");
  }
  return port;
}

function hostForUrl(host: string): string {
  return host.includes(":") ? `[${host}]` : host;
}

function validateCreateOptions(options: CreateDockerBrowserOptions): void {
  assertOptionsObject(options);
  if (options.id !== undefined) assertNonEmptyString(options.id, "id");
  if (!isRecord(options.workspace)) throw new TypeError("workspace must be an object.");
  if (!isRecord(options.network) || options.network.mode !== "bridge") {
    throw new TypeError('network must be { mode: "bridge" }.');
  }
  if (!isRecord(options.desktop) || options.desktop.protocol !== "novnc") {
    throw new TypeError('desktop must use protocol: "novnc".');
  }
  if (!/^[\x20-\x7e]{8}$/.test(options.desktop.password)) {
    throw new TypeError("desktop.password must contain exactly 8 printable ASCII characters.");
  }
  if (!isRecord(options.desktop.viewport)) {
    throw new TypeError("desktop.viewport must be an object.");
  }
  assertIntegerInRange(options.desktop.viewport.width, "desktop.viewport.width", 640, 3840);
  assertIntegerInRange(options.desktop.viewport.height, "desktop.viewport.height", 480, 2160);
  if (options.runtime?.maxProcesses !== undefined && options.runtime.maxProcesses < 1) {
    throw new RangeError("runtime.maxProcesses must allow the browser service process.");
  }
}

function assertIntegerInRange(value: number, name: string, min: number, max: number): void {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be a safe integer between ${min} and ${max}.`);
  }
}

function assertPositiveSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer.`);
  }
}

function assertNonEmptyString(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${name} must be a non-empty string.`);
  }
}

function assertOptionsObject(value: unknown): asserts value is Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError("options must be an object.");
}

function isSandboxClient(value: unknown): value is DockerSandboxClient {
  return (
    isRecord(value) &&
    typeof value.pullImage === "function" &&
    typeof value.createSandbox === "function" &&
    typeof value.resumeSandbox === "function"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
