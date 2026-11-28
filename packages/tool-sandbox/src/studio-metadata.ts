import type { AnyTool } from "@anvia/core/tool";
import type { SandboxDesktop } from "./remote/desktop";
import type { StudioDesktopView, StudioSandbox } from "./remote/studio";
import type {
  DockerSandbox,
  DockerSandboxInspectionOptions,
  SandboxRuntime,
  SandboxStudioDiscoveryOptions,
} from "./types";

/**
 * Well-known symbol attached to sandbox and desktop tools so `@anvia/studio`
 * can discover sandboxes, `agentIds`, `toolNames`, and desktop views without
 * adding a package dependency between `@anvia/sandbox` and `@anvia/studio`.
 */
export const STUDIO_SANDBOX_SYMBOL = Symbol.for("anvia.studio.sandbox");

export interface StudioSandboxToolMetadata {
  getStudioSandbox(): StudioSandbox;
}

export interface LocalStudioSandboxOptions {
  /** Agents that use this sandbox, as Studio's `sandboxes[].agentIds`. */
  agentIds?: readonly string[];
  /** Tools that act on it. */
  toolNames?: readonly string[];
  /** Enable read-only file browsing. Default true. */
  files?: boolean;
  /** Enable published port inspection when supported. Default true. */
  ports?: boolean;
  /** Enable process and log inspection. Default true. */
  processes?: boolean;
  /** Destroy the owned `DockerSandbox` when Studio shuts down. Default false. */
  disposeOnShutdown?: boolean;
}

const viewIdPattern = /^[a-z0-9](?:[a-z0-9_-]{0,62})$/;

export function isDockerSandbox(value: unknown): value is DockerSandbox {
  if (!isPlainRecord(value)) return false;

  const runtime = value.runtime;
  return (
    typeof runtime === "object" &&
    runtime !== null &&
    typeof value.inspector === "function" &&
    typeof value.destroy === "function"
  );
}

export function isSandboxRuntime(value: unknown): value is SandboxRuntime {
  return (
    isPlainRecord(value) &&
    typeof value.id === "string" &&
    typeof value.provider === "string" &&
    typeof value.workdir === "string" &&
    typeof value.listFiles === "function" &&
    typeof value.readFile === "function" &&
    typeof value.listProcesses === "function" &&
    typeof value.readProcessLogs === "function"
  );
}

export function createLocalStudioSandbox(
  sandbox: DockerSandbox | SandboxRuntime,
  options: LocalStudioSandboxOptions = {},
): StudioSandbox {
  if (!isDockerSandbox(sandbox) && !isSandboxRuntime(sandbox)) {
    throw new TypeError("studioSandbox requires a DockerSandbox or SandboxRuntime handle.");
  }

  if (!isPlainRecord(options as unknown)) {
    throw new TypeError("studioSandbox options must be an object.");
  }

  const typedOptions: LocalStudioSandboxOptions = options;
  validateLocalStudioOptions(typedOptions, isDockerSandbox(sandbox));

  const files = typedOptions.files ?? true;
  const ports = typedOptions.ports ?? true;
  const processes = typedOptions.processes ?? true;

  let inspector: StudioSandbox["inspector"];

  if (isDockerSandbox(sandbox)) {
    const inspectOptions: { files?: boolean; ports?: boolean; processes?: boolean } = {};

    if (files) inspectOptions.files = true;

    if (ports) inspectOptions.ports = true;

    if (processes) inspectOptions.processes = true;

    inspector = sandbox.inspector(inspectOptions as DockerSandboxInspectionOptions);
  } else {
    inspector = buildRuntimeInspector(sandbox, {
      files,
      ports,
      explicitPorts: typedOptions.ports === true,
      processes,
    });
  }

  const registration: StudioSandbox = { inspector };

  if (typedOptions.agentIds !== undefined) {
    registration.agentIds = [...typedOptions.agentIds];
  }

  if (typedOptions.toolNames !== undefined) {
    registration.toolNames = [...typedOptions.toolNames];
  }

  if (typedOptions.disposeOnShutdown === true && isDockerSandbox(sandbox)) {
    registration.dispose = () => sandbox.destroy();
  }

  return registration;
}

export function attachSandboxStudioMetadata(
  tools: readonly AnyTool[],
  sandbox: SandboxRuntime | DockerSandbox,
  studioOption: false | SandboxStudioDiscoveryOptions | undefined,
): void {
  if (studioOption === false) return;

  if (studioOption !== undefined && !isPlainRecord(studioOption)) {
    throw new TypeError("studio option must be false or an object.");
  }

  const opts: LocalStudioSandboxOptions = {};

  if (studioOption !== undefined) {
    if (studioOption.files !== undefined) opts.files = studioOption.files;

    if (studioOption.ports !== undefined) opts.ports = studioOption.ports;

    if (studioOption.processes !== undefined) opts.processes = studioOption.processes;

    if (studioOption.disposeOnShutdown !== undefined) {
      opts.disposeOnShutdown = studioOption.disposeOnShutdown;
    }
  }

  validateLocalStudioOptions(opts, isDockerSandbox(sandbox));

  let cached: StudioSandbox | undefined;
  const metadata: StudioSandboxToolMetadata = {
    getStudioSandbox() {
      cached ??= createLocalStudioSandbox(sandbox, opts);
      return cached;
    },
  };

  for (const tool of tools) {
    defineStudioMetadata(tool, metadata);
  }
}

export function attachDesktopStudioMetadata(
  tools: readonly AnyTool[],
  desktop: SandboxDesktop,
  createView: (
    desktop: SandboxDesktop,
    opts?: { id?: string; label?: string },
  ) => StudioDesktopView,
  studioOption: false | { id?: string; label?: string } | undefined,
): void {
  if (studioOption === false) return;

  if (studioOption !== undefined && !isPlainRecord(studioOption)) {
    throw new TypeError("studio option must be false or an object.");
  }

  const viewId = studioOption?.id ?? "desktop";
  const viewLabel = studioOption?.label ?? "Desktop";

  if (typeof viewId !== "string" || !viewIdPattern.test(viewId)) {
    throw new TypeError("studio.id must be a stable lowercase identifier.");
  }

  if (typeof viewLabel !== "string" || viewLabel.trim().length === 0) {
    throw new TypeError("studio.label must be a non-empty string.");
  }

  if (
    typeof desktop.id !== "string" ||
    desktop.id.length === 0 ||
    typeof desktop.provider !== "string" ||
    desktop.provider.length === 0
  ) {
    return;
  }

  const id = desktop.id;
  const provider = desktop.provider;
  const snapshotViewOpts = { id: viewId, label: viewLabel };
  let cached: StudioSandbox | undefined;

  const metadata: StudioSandboxToolMetadata = {
    getStudioSandbox() {
      cached ??= {
        inspector: {
          id,
          provider,
          workdir: desktop.workdir ?? "/workspace",
        },
        views: [createView(desktop, snapshotViewOpts)],
      };
      return cached;
    },
  };

  for (const tool of tools) {
    defineStudioMetadata(tool, metadata);
  }
}

function validateLocalStudioOptions(options: LocalStudioSandboxOptions, canDispose: boolean): void {
  if (options.files !== undefined && typeof options.files !== "boolean") {
    throw new TypeError("studio.files must be a boolean.");
  }

  if (options.ports !== undefined && typeof options.ports !== "boolean") {
    throw new TypeError("studio.ports must be a boolean.");
  }

  if (options.processes !== undefined && typeof options.processes !== "boolean") {
    throw new TypeError("studio.processes must be a boolean.");
  }

  if (options.disposeOnShutdown !== undefined && typeof options.disposeOnShutdown !== "boolean") {
    throw new TypeError("studio.disposeOnShutdown must be a boolean.");
  }

  if (options.disposeOnShutdown === true && !canDispose) {
    throw new TypeError(
      "disposeOnShutdown: true requires a DockerSandbox handle (not a bare SandboxRuntime).",
    );
  }

  if (options.files === false && options.ports === false && options.processes === false) {
    throw new TypeError("Sandbox inspector must enable at least one capability.");
  }

  if (
    options.agentIds !== undefined &&
    (!Array.isArray(options.agentIds) ||
      !options.agentIds.every((item) => typeof item === "string"))
  ) {
    throw new TypeError("studioSandbox agentIds must be an array of strings.");
  }

  if (
    options.toolNames !== undefined &&
    (!Array.isArray(options.toolNames) ||
      !options.toolNames.every((item) => typeof item === "string"))
  ) {
    throw new TypeError("studioSandbox toolNames must be an array of strings.");
  }
}

function defineStudioMetadata(tool: AnyTool, metadata: StudioSandboxToolMetadata): void {
  Object.defineProperty(tool, STUDIO_SANDBOX_SYMBOL, {
    value: metadata,
    configurable: true,
    enumerable: false,
    writable: false,
  });
}

function buildRuntimeInspector(
  runtime: SandboxRuntime,
  caps: { files: boolean; ports: boolean; explicitPorts: boolean; processes: boolean },
): StudioSandbox["inspector"] {
  if (!caps.files && !caps.ports && !caps.processes) {
    throw new TypeError("Sandbox inspector must enable at least one capability.");
  }

  const inspector: StudioSandbox["inspector"] = {
    id: runtime.id,
    provider: runtime.provider,
    workdir: runtime.workdir,
  };

  if (caps.files) {
    inspector.listFiles = runtime.listFiles.bind(runtime);
    inspector.readFile = runtime.readFile.bind(runtime);
  }

  const includePorts =
    caps.ports &&
    Array.isArray(runtime.publishedPorts) &&
    (caps.explicitPorts || runtime.provider === "docker" || runtime.publishedPorts.length > 0);

  if (includePorts) {
    inspector.publishedPorts = [...runtime.publishedPorts];
  }

  if (caps.processes) {
    inspector.listProcesses = runtime.listProcesses.bind(runtime);
    inspector.readProcessLogs = runtime.readProcessLogs.bind(runtime);
  }

  return inspector;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
