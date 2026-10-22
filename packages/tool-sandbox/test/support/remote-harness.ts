import { mkdtemp, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SandboxDaemon, type SandboxDaemonOptions } from "../../src/daemon/index";
import { RemoteSandboxHub, type RemoteSandboxHubOptions } from "../../src/remote/index";
import type { SandboxRuntime, SandboxRuntimeLimits } from "../../src/types";

export const sandboxId = "sandbox-1";
export const token = "test-token";

export interface RemoteHarness {
  hub: RemoteSandboxHub;
  daemon: SandboxDaemon;
  runtime: SandboxRuntime;
  port: number;
  workdir: string;
  stateDir: string;
  url: string;
  logs: string[];
  /** Start another daemon against this harness's directories. */
  startDaemon(overrides?: Partial<SandboxDaemonOptions>): SandboxDaemon;
  cleanup(): Promise<void>;
}

export interface RemoteHarnessOptions {
  limits?: SandboxRuntimeLimits;
  hub?: Partial<RemoteSandboxHubOptions>;
  daemon?: Partial<SandboxDaemonOptions>;
  /** Wait for the daemon's first handshake. Default true. */
  connect?: boolean;
}

/** A hub and an in-process daemon over a real loopback WebSocket, with a temp workdir. */
export async function createRemoteHarness(
  options: RemoteHarnessOptions = {},
): Promise<RemoteHarness> {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "anvia-remote-")));
  const workdir = path.join(root, "workspace");
  const stateDir = path.join(root, "state");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(workdir);

  const hub = new RemoteSandboxHub({
    authorize: (candidate) => (candidate === token ? { sandboxId } : null),
    connectTimeoutMs: 5_000,
    ...options.hub,
  });
  const { port } = await hub.listen({ host: "127.0.0.1" });
  const url = `ws://127.0.0.1:${port}`;
  const logs: string[] = [];
  const daemons: SandboxDaemon[] = [];

  const startDaemon = (overrides: Partial<SandboxDaemonOptions> = {}) => {
    let daemonOptions: SandboxDaemonOptions = {
      controlUrl: url,
      token,
      workdir,
      stateDir,
      reconnect: { initialDelayMs: 25, maxDelayMs: 100 },
      onLog: (level, message) => logs.push(`${level}: ${message}`),
    };
    if (options.limits !== undefined) daemonOptions = { ...daemonOptions, limits: options.limits };
    const daemon = new SandboxDaemon({ ...daemonOptions, ...options.daemon, ...overrides });
    daemons.push(daemon);
    daemon.start();
    return daemon;
  };

  const daemon = startDaemon();
  if (options.connect !== false) await daemon.ready();

  return {
    hub,
    daemon,
    runtime: hub.runtime(sandboxId, { workdir }),
    port,
    workdir,
    stateDir,
    url,
    logs,
    startDaemon,
    async cleanup() {
      await Promise.all(daemons.map((candidate) => candidate.stop()));
      await hub.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

export async function eventually<T>(
  check: () => T | Promise<T>,
  timeoutMs = 5_000,
): Promise<NonNullable<T>> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value as NonNullable<T>;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw lastError instanceof Error ? lastError : new Error("Condition was not met in time.");
}
