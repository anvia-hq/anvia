import { fileURLToPath } from "node:url";
import type { DockerSandbox, DockerSandboxClient } from "@anvia/sandbox";
import { DockerBrowserHandle } from "./docker-browser";
import {
  assertOptionsObject,
  assertPositiveSafeInteger,
  boundedSignal,
  defaultLifecycleTimeoutMs,
  isRecord,
} from "./lifecycle";
import { cdpPort, noVncPort } from "./readiness";
import type {
  CreateDockerBrowserOptions,
  DockerBrowser,
  DockerBrowserClientOptions,
  PullDockerBrowserImageOptions,
  ResumeDockerBrowserOptions,
} from "./types";

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
    const bounded = boundedSignal(options, defaultLifecycleTimeoutMs, "pull-image");
    try {
      await this.sandboxClient.pullImage({ image: this.image, abortSignal: bounded.signal });
      bounded.throwIfAborted();
    } catch (error) {
      throw bounded.normalize(error, "Unable to pull the browser image.", "startup_failed");
    } finally {
      bounded.dispose();
    }
  }

  async createBrowser(options: CreateDockerBrowserOptions): Promise<DockerBrowser> {
    validateCreateOptions(options);
    const bounded = boundedSignal(options, defaultLifecycleTimeoutMs, "create-browser");
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
      labels: { "anvia.browser.schema": browserSchema },
      resources,
      security: {
        noNewPrivileges: true,
        dropCapabilities: ["ALL"],
        addCapabilities: ["SYS_CHROOT"],
        seccompProfile: { type: "path", path: seccompProfilePath },
      },
      abortSignal: bounded.signal,
    };
    if (options.id !== undefined) sandboxOptions = { ...sandboxOptions, id: options.id };
    if (options.runtime !== undefined) {
      sandboxOptions = { ...sandboxOptions, runtime: options.runtime };
    }
    let sandbox: DockerSandbox | undefined;
    try {
      sandbox = await this.sandboxClient.createSandbox(sandboxOptions);
      await configureBrowser(sandbox, options, bounded.signal);
      await startBrowserServices(sandbox, bounded.signal);
      bounded.throwIfAborted();
      return new DockerBrowserHandle(sandbox);
    } catch (error) {
      let cleanupError: unknown;
      try {
        await sandbox?.destroy();
      } catch (caught) {
        cleanupError = caught;
      }
      throw bounded.normalize(
        combineCleanupError(error, cleanupError, "Browser sandbox cleanup also failed."),
        "Unable to configure the browser sandbox.",
        "startup_failed",
      );
    } finally {
      bounded.dispose();
    }
  }

  async resumeBrowser(options: ResumeDockerBrowserOptions): Promise<DockerBrowser> {
    assertOptionsObject(options);
    assertNonEmptyString(options.id, "id");
    const bounded = boundedSignal(options, defaultLifecycleTimeoutMs, "resume-browser");
    let sandbox: DockerSandbox | undefined;
    try {
      sandbox = await this.sandboxClient.resumeSandbox({
        id: options.id,
        abortSignal: bounded.signal,
      });
      await assertBrowserImage(sandbox, bounded.signal);
      await startBrowserServices(sandbox, bounded.signal);
      bounded.throwIfAborted();
      return new DockerBrowserHandle(sandbox);
    } catch (error) {
      let cleanupError: unknown;
      try {
        await sandbox?.stop();
      } catch (caught) {
        cleanupError = caught;
      }
      throw bounded.normalize(
        combineCleanupError(error, cleanupError, "Resumed browser cleanup also failed."),
        "Unable to resume browser services.",
        "startup_failed",
      );
    } finally {
      bounded.dispose();
    }
  }
}

async function configureBrowser(
  sandbox: DockerSandbox,
  options: CreateDockerBrowserOptions,
  abortSignal: AbortSignal,
): Promise<void> {
  const result = await sandbox.runtime.exec({
    command: "/usr/local/bin/anvia-browser-configure",
    input: JSON.stringify({
      password: options.desktop.password,
      width: options.desktop.viewport.width,
      height: options.desktop.viewport.height,
    }),
    abortSignal,
  });
  if (result.status !== "exited" || result.exitCode !== 0) {
    throw new Error("Browser image rejected its runtime configuration.");
  }
}

async function assertBrowserImage(sandbox: DockerSandbox, abortSignal: AbortSignal): Promise<void> {
  const result = await sandbox.runtime.exec({
    command: "/usr/local/bin/anvia-browser-version",
    abortSignal,
  });
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
  abortSignal: AbortSignal,
): Promise<void> {
  await sandbox.runtime.startProcess({
    command: "/usr/local/bin/anvia-browser-start",
    abortSignal,
  });
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
  if (options.timeoutMs !== undefined) assertPositiveSafeInteger(options.timeoutMs, "timeoutMs");
  if (options.runtime?.maxProcesses !== undefined && options.runtime.maxProcesses < 1) {
    throw new RangeError("runtime.maxProcesses must allow the browser service process.");
  }
}

function assertIntegerInRange(value: number, name: string, min: number, max: number): void {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be a safe integer between ${min} and ${max}.`);
  }
}

function assertNonEmptyString(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${name} must be a non-empty string.`);
  }
}

function isSandboxClient(value: unknown): value is DockerSandboxClient {
  return (
    isRecord(value) &&
    typeof value.pullImage === "function" &&
    typeof value.createSandbox === "function" &&
    typeof value.resumeSandbox === "function"
  );
}

function combineCleanupError(error: unknown, cleanupError: unknown, message: string): unknown {
  return cleanupError === undefined ? error : new AggregateError([error, cleanupError], message);
}
