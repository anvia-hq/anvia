import { randomUUID } from "node:crypto";
import { DockerSandboxError } from "../errors";
import { createLocalStudioSandbox, type LocalStudioSandboxOptions } from "../studio-metadata";
import type { DockerSandbox, SandboxPublishedPort, SandboxRuntime } from "../types";
import type { SandboxDesktop } from "./desktop";
import type { RemoteSandboxHub } from "./hub";
import type { DesktopControl } from "./protocol";
import { RfbClientFilter } from "./rfb-filter";
import type { TunnelHandle } from "./tunnel";

export type { LocalStudioSandboxOptions };

export interface StudioSandboxOptions {
  /** Agents that use this sandbox, as Studio's `sandboxes[].agentIds`. */
  agentIds?: readonly string[];
  /** Tools that act on it. A call to one opens the desktop panel in the Playground. */
  toolNames?: readonly string[];
  /** Workspace directory to show until the daemon reports its own. */
  workdir?: string;
  /** Options for the desktop view, or `false` to register the sandbox without one. */
  desktop?: false | { id?: string; label?: string };
}

/** What Studio's `sandboxes: [...]` takes. Typed here so `@anvia/sandbox` need not depend on Studio. */
export interface StudioSandbox {
  inspector: {
    id: string;
    provider: string;
    workdir: string;
    containerRuntime?: string;
    publishedPorts?: readonly SandboxPublishedPort[];
    listFiles?: SandboxRuntime["listFiles"];
    readFile?: SandboxRuntime["readFile"];
    listProcesses?: SandboxRuntime["listProcesses"];
    readProcessLogs?: SandboxRuntime["readProcessLogs"];
  };
  agentIds?: readonly string[];
  toolNames?: readonly string[];
  views?: readonly StudioDesktopView[];
  /** Optional cleanup invoked when Studio shuts down (only set when `disposeOnShutdown: true`). */
  dispose?: () => Promise<void> | void;
}

export interface StudioDesktopView {
  id: string;
  label: string;
  source: {
    protocol: "novnc";
    connect(options: { abortSignal?: AbortSignal }): Promise<StudioViewStream>;
    control: StudioViewControl;
  };
  access: { mode: "local" };
  authentication: { type: "none" };
}

interface StudioViewStream {
  write(data: Uint8Array): Promise<void>;
  readonly output: AsyncIterable<Uint8Array>;
  close(): void;
  readonly exit: Promise<unknown>;
}

interface StudioViewControlSnapshot {
  mode: "agent" | "human";
  ownerId?: string;
  expiresAt?: string;
}

interface StudioViewControl {
  snapshot(): Promise<StudioViewControlSnapshot>;
  acquireHumanControl(options: {
    ownerId: string;
    leaseTimeoutMs: number;
    abortSignal?: AbortSignal;
  }): Promise<StudioViewControlLease>;
}

interface StudioViewControlLease {
  id: string;
  ownerId: string;
  readonly expiresAt: string;
  renew(options: { leaseTimeoutMs: number }): Promise<StudioViewControlSnapshot>;
  release(): Promise<void>;
}

/**
 * Everything Studio needs to show a sandbox: either a local `DockerSandbox` / `SandboxRuntime`
 * inspector, or a remote sandbox on a `RemoteSandboxHub` (with an optional live desktop view).
 *
 * ```ts
 * // Local Docker sandbox
 * new Studio([agent], { sandboxes: [studioSandbox(sandbox, { agentIds: [agent.id] })] });
 *
 * // Remote sandbox on a hub
 * new Studio([agent], { sandboxes: [studioSandbox(hub, "sandbox-1", { agentIds: [agent.id] })] });
 * ```
 */
export function studioSandbox(
  sandbox: DockerSandbox | SandboxRuntime,
  options?: LocalStudioSandboxOptions,
): StudioSandbox;
export function studioSandbox(
  hub: RemoteSandboxHub,
  sandboxId: string,
  options?: StudioSandboxOptions,
): StudioSandbox;
export function studioSandbox(
  sandboxOrHub: DockerSandbox | SandboxRuntime | RemoteSandboxHub,
  sandboxIdOrOptions?: string | LocalStudioSandboxOptions,
  remoteOptions: StudioSandboxOptions = {},
): StudioSandbox {
  if (typeof sandboxIdOrOptions !== "string") {
    if (
      typeof sandboxOrHub === "object" &&
      sandboxOrHub !== null &&
      typeof (sandboxOrHub as { runtime?: unknown }).runtime === "function" &&
      typeof (sandboxOrHub as { desktop?: unknown }).desktop === "function"
    ) {
      throw new TypeError("studioSandbox(hub, sandboxId) requires a sandboxId string.");
    }

    return createLocalStudioSandbox(
      sandboxOrHub as DockerSandbox | SandboxRuntime,
      sandboxIdOrOptions,
    );
  }

  const hub = sandboxOrHub as RemoteSandboxHub;
  const sandboxId = sandboxIdOrOptions;
  const runtime = hub.runtime(
    sandboxId,
    remoteOptions.workdir === undefined ? {} : { workdir: remoteOptions.workdir },
  );
  const registration: StudioSandbox = {
    inspector: {
      id: runtime.id,
      provider: runtime.provider,
      workdir: runtime.workdir,
      listFiles: runtime.listFiles.bind(runtime),
      readFile: runtime.readFile.bind(runtime),
      listProcesses: runtime.listProcesses.bind(runtime),
      readProcessLogs: runtime.readProcessLogs.bind(runtime),
    },
  };

  if (remoteOptions.agentIds !== undefined) registration.agentIds = [...remoteOptions.agentIds];

  if (remoteOptions.toolNames !== undefined) registration.toolNames = [...remoteOptions.toolNames];

  if (remoteOptions.desktop !== false) {
    registration.views = [
      studioDesktopView(hub.desktop(sandboxId), {
        id: remoteOptions.desktop?.id ?? "desktop",
        label: remoteOptions.desktop?.label ?? "Desktop",
      }),
    ];
  }

  return registration;
}

/** A Studio view for one desktop. Use {@link studioSandbox} unless you need only the view. */
export function studioDesktopView(
  desktop: SandboxDesktop,
  options: { id?: string; label?: string } = {},
): StudioDesktopView {
  const lease: { holder?: string; expiresAt: number } = { expiresAt: 0 };
  const mayType = () => lease.holder !== undefined && Date.now() < lease.expiresAt;
  const remember = (holder: string, control: DesktopControl) => {
    lease.holder = holder;
    lease.expiresAt = control.expiresAt === undefined ? 0 : Date.parse(control.expiresAt);
  };
  const forget = () => {
    delete lease.holder;
  };

  const control: StudioViewControl = {
    async snapshot() {
      return snapshotOf(await desktop.control());
    },
    async acquireHumanControl({ ownerId, leaseTimeoutMs, abortSignal }) {
      const held = await takeover(
        desktop,
        ownerId,
        leaseTimeoutMs,
        abortSignal,
        "human_controlled",
      );
      remember(ownerId, held);
      let expiresAt = held.expiresAt ?? new Date(Date.now() + leaseTimeoutMs).toISOString();
      return {
        id: randomUUID(),
        ownerId,
        get expiresAt() {
          return expiresAt;
        },
        async renew({ leaseTimeoutMs: ms }) {
          try {
            const renewed = await takeover(desktop, ownerId, ms, undefined, "invalid_state");
            remember(ownerId, renewed);
            expiresAt = renewed.expiresAt ?? expiresAt;
            return snapshotOf(renewed);
          } catch (error) {
            forget();
            throw error;
          }
        },
        async release() {
          forget();
          await desktop.release({ holder: ownerId });
        },
      };
    },
  };

  return {
    id: options.id ?? "desktop",
    label: options.label ?? "Desktop",
    source: {
      protocol: "novnc",
      control,
      async connect({ abortSignal }: { abortSignal?: AbortSignal } = {}) {
        const handle = await desktop.openViewer({ abortSignal });
        return filteredStream(handle, new RfbClientFilter(mayType));
      },
    },
    access: { mode: "local" },
    authentication: { type: "none" },
  };
}

function filteredStream(handle: TunnelHandle, filter: RfbClientFilter): StudioViewStream {
  return {
    async write(data) {
      let forward: Uint8Array;
      try {
        forward = filter.push(data);
      } catch (error) {
        handle.close();
        throw error;
      }

      if (forward.byteLength > 0) await handle.write(forward);
    },
    output: handle.output,
    close: () => handle.close(),
    exit: handle.exit,
  };
}

/** Take or renew the hold, turning "someone else holds it" into the codes Studio reads. */
async function takeover(
  desktop: SandboxDesktop,
  holder: string,
  leaseMs: number,
  abortSignal: AbortSignal | undefined,
  lockedCode: "human_controlled" | "invalid_state",
): Promise<DesktopControl> {
  try {
    return await desktop.takeover({ holder, leaseMs, abortSignal });
  } catch (error) {
    if (error instanceof DockerSandboxError && error.code === "desktop_locked") {
      throw Object.assign(new Error(error.message, { cause: error }), { code: lockedCode });
    }

    throw error;
  }
}

function snapshotOf(control: DesktopControl): StudioViewControlSnapshot {
  if (!control.held) return { mode: "agent" };

  const snapshot: StudioViewControlSnapshot = { mode: "human" };

  if (control.holder !== undefined) snapshot.ownerId = control.holder;

  if (control.expiresAt !== undefined) snapshot.expiresAt = control.expiresAt;

  return snapshot;
}
