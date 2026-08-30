import type { DockerSandbox, DockerSandboxPublishedPort } from "@anvia/sandbox";
import { type connectPlaywrightBrowser } from "./connection";
import type { BrowserControlState } from "./control";
import { BrowserError } from "./errors";
import type { BrowserCapability } from "./types";

export const cdpPort = 9222;
export const noVncPort = 6080;
export const browserCapabilities = ["runtime", "browser", "automation", "desktop"] as const;

const automationProbeAttemptTimeoutMs = 5_000;

export async function probeBrowserCapability(options: {
  capability: BrowserCapability;
  sandbox: DockerSandbox;
  control: BrowserControlState;
  connectBrowser: typeof connectPlaywrightBrowser;
  abortSignal: AbortSignal;
  deadline: number;
}): Promise<void> {
  const { capability, sandbox, abortSignal, deadline } = options;
  switch (capability) {
    case "runtime":
      if (sandbox.state !== "running") {
        throw new BrowserError(`Browser is not running: ${sandbox.state}`, "invalid_state");
      }
      return;
    case "browser":
      await sandbox.runtime.waitForPort({
        containerPort: cdpPort,
        timeoutMs: remainingTime(deadline),
        abortSignal,
      });
      await assertCdpHttpReady(`${endpointFor(sandbox, cdpPort)}/json/version`, abortSignal);
      return;
    case "desktop":
      await sandbox.runtime.waitForPort({
        containerPort: noVncPort,
        timeoutMs: remainingTime(deadline),
        abortSignal,
      });
      await assertHttpReady(`${endpointFor(sandbox, noVncPort)}/vnc.html`, abortSignal);
      return;
    case "automation": {
      await sandbox.runtime.waitForPort({
        containerPort: cdpPort,
        timeoutMs: remainingTime(deadline),
        abortSignal,
      });
      await assertCdpHttpReady(`${endpointFor(sandbox, cdpPort)}/json/version`, abortSignal);
      let lastProbeFailure: unknown;
      for (let attempt = 0; ; attempt += 1) {
        abortSignal.throwIfAborted();
        try {
          const connection = await options.connectBrowser({
            endpointUrl: endpointFor(sandbox, cdpPort),
            control: options.control,
            timeoutMs: Math.min(automationProbeAttemptTimeoutMs, remainingTime(deadline)),
            abortSignal,
          });
          try {
            if (connection.closed) {
              throw new Error("CDP connection closed during initialization.");
            }
          } finally {
            await connection.disconnect({
              timeoutMs: remainingTime(deadline),
              abortSignal,
            });
          }
          abortSignal.throwIfAborted();
          return;
        } catch (error) {
          if (abortSignal.aborted) throw lastProbeFailure ?? error;
          lastProbeFailure = error;
          try {
            await waitForRetry(abortSignal, Math.min(500, 50 * 2 ** Math.min(attempt, 3)));
          } catch (retryError) {
            if (abortSignal.aborted) throw lastProbeFailure;
            throw retryError;
          }
        }
      }
    }
  }
}

export function endpointFor(sandbox: DockerSandbox, containerPort: number): string {
  const published = publishedPort(sandbox, containerPort);
  return `http://${hostForUrl(published.host)}:${published.hostPort}`;
}

export function normalizeReadinessError(
  error: unknown,
  capability: BrowserCapability,
  state: { callerAborted: boolean; timedOut: boolean },
): BrowserError {
  if (state.callerAborted) {
    return new BrowserError("Browser readiness was cancelled by the caller.", "cancelled", {
      cause: error,
      capability,
      phase: "readiness",
    });
  }
  if (state.timedOut) {
    if (error instanceof BrowserError && error.code === "transport_failure") {
      return new BrowserError(error.message, error.code, {
        cause: error,
        capability,
        phase: "readiness",
        recovery: error.recovery,
        retryable: error.retryable,
      });
    }
    return new BrowserError(
      `Browser ${capability} capability did not become ready before the timeout.`,
      "readiness_timeout",
      { cause: error, capability, phase: "readiness" },
    );
  }
  if (
    error instanceof BrowserError &&
    (error.code === "connection_closed" || error.code === "runtime_destroyed")
  ) {
    return error;
  }
  return new BrowserError(`Browser ${capability} capability is not ready.`, "not_ready", {
    cause: error,
    capability,
    phase: "readiness",
  });
}

async function assertCdpHttpReady(url: string, abortSignal: AbortSignal): Promise<void> {
  await assertHttpReady(url, abortSignal, async (response) => {
    const value: unknown = await response.json();
    if (
      !isRecord(value) ||
      typeof value.webSocketDebuggerUrl !== "string" ||
      !value.webSocketDebuggerUrl.startsWith("ws")
    ) {
      throw new Error("CDP version endpoint did not expose a WebSocket debugger URL.");
    }
  });
}

async function assertHttpReady(
  url: string,
  abortSignal: AbortSignal,
  verify?: (response: Response) => Promise<void>,
): Promise<void> {
  while (true) {
    abortSignal.throwIfAborted();
    try {
      const response = await fetch(url, { signal: abortSignal, redirect: "error" });
      try {
        if (response.ok) {
          await verify?.(response);
          return;
        }
      } finally {
        await response.body?.cancel().catch(() => undefined);
      }
    } catch (error) {
      if (abortSignal.aborted) throw abortSignal.reason ?? error;
    }
    await waitForRetry(abortSignal);
  }
}

async function waitForRetry(abortSignal: AbortSignal, delayMs = 50): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => finish(), delayMs);
    timer.unref?.();
    const abort = () => finish(abortSignal.reason ?? new DOMException("Aborted", "AbortError"));
    abortSignal.addEventListener("abort", abort, { once: true });
    function finish(error?: unknown): void {
      clearTimeout(timer);
      abortSignal.removeEventListener("abort", abort);
      if (error === undefined) resolve();
      else reject(error);
    }
  });
}

function remainingTime(deadline: number): number {
  return Math.max(1, deadline - Date.now());
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
