import type { AutomationCommand, AutomationTabResult } from "./automation-protocol";
import {
  AutomationWorkerClient,
  type AutomationBackend,
  type AutomationWorkerFactory,
} from "./automation-client";
import type { BrowserControlState } from "./control";
import { BrowserError, cancellationError } from "./errors";
import { AsyncMutex, ResourceScheduler } from "./scheduler";
import type {
  BrowserActionOptions,
  BrowserConnectOptions,
  BrowserLifecycleOptions,
  BrowserNavigationPolicy,
  BrowserTab,
  PlaywrightBrowserConnection,
} from "./types";

const defaultConnectionTimeoutMs = 30_000;
const defaultActionTimeoutMs = 10_000;
const defaultMaxConcurrentTabs = 8;
const defaultMaxQueuedActions = 1_000;
const maxClosedTabTombstones = 10_000;
const maxTimerMs = 2_147_483_647;

export async function connectPlaywrightBrowser(options: {
  endpointUrl: string;
  control: BrowserControlState;
  timeoutMs?: number;
  abortSignal?: AbortSignal;
  scheduling?: BrowserConnectOptions["scheduling"];
  workerFactory?: AutomationWorkerFactory;
  onClosed?: (connection: PlaywrightBrowserConnectionImpl) => void;
}): Promise<PlaywrightBrowserConnectionImpl> {
  const timeoutMs = options.timeoutMs ?? defaultConnectionTimeoutMs;
  assertPositiveSafeInteger(timeoutMs, "timeoutMs");
  options.abortSignal?.throwIfAborted();
  const backend = await AutomationWorkerClient.connect({
    endpointUrl: options.endpointUrl,
    timeoutMs,
    ...(options.abortSignal === undefined ? {} : { abortSignal: options.abortSignal }),
    ...(options.workerFactory === undefined ? {} : { workerFactory: options.workerFactory }),
  });
  return new PlaywrightBrowserConnectionImpl({
    backend,
    control: options.control,
    scheduling: options.scheduling,
    ...(options.onClosed === undefined ? {} : { onClosed: options.onClosed }),
  });
}

export class PlaywrightBrowserConnectionImpl implements PlaywrightBrowserConnection {
  private readonly backend: AutomationBackend;
  private readonly control: BrowserControlState;
  private readonly scheduler: ResourceScheduler;
  private readonly compatibilityMutex = new AsyncMutex();
  private readonly contextMutex = new AsyncMutex();
  private readonly closingTabs = new Set<string>();
  private readonly closedTabs = new Set<string>();
  private navigationPolicyKey: string | undefined;
  private navigationGuard: Promise<void> = Promise.resolve();
  private isClosed = false;
  private disconnectCompleted = false;
  private disconnectPromise: Promise<void> | undefined;
  private removeDisconnectedListener: (() => void) | undefined;
  private readonly onClosed: ((connection: PlaywrightBrowserConnectionImpl) => void) | undefined;

  constructor(options: {
    backend: AutomationBackend;
    control: BrowserControlState;
    scheduling?: BrowserConnectOptions["scheduling"];
    onClosed?: (connection: PlaywrightBrowserConnectionImpl) => void;
  }) {
    this.backend = options.backend;
    this.control = options.control;
    this.onClosed = options.onClosed;
    const scheduling = normalizeScheduling(options.scheduling);
    this.scheduler = new ResourceScheduler(scheduling);
    this.removeDisconnectedListener = this.backend.onDisconnected(() => this.markClosed());
  }

  get closed(): boolean {
    return this.isClosed || this.backend.closed;
  }

  async listTabs(options: BrowserActionOptions = {}): Promise<readonly BrowserTab[]> {
    assertOptionsObject(options);
    return this.runContextAction(
      options.abortSignal,
      options.timeoutMs ?? defaultActionTimeoutMs,
      "list-tabs",
      (signal) =>
        this.backend.command<readonly BrowserTab[]>(
          { method: "listTabs", params: {} },
          { abortSignal: signal, cancelOperation: true, phase: "list-tabs" },
        ),
    );
  }

  setNavigationPolicy(policy: BrowserNavigationPolicy): void {
    this.assertOpen();
    const key = JSON.stringify(policy);
    if (this.navigationPolicyKey !== undefined) {
      if (this.navigationPolicyKey !== key) {
        throw new TypeError("Browser connection already has a different navigation policy.");
      }
      return;
    }
    this.navigationPolicyKey = key;
    const installation = this.withActionTimeout(
      undefined,
      defaultActionTimeoutMs,
      "navigation-policy",
      (signal) =>
        this.scheduler.run("browser-context", signal, (scheduledSignal) =>
          this.contextMutex.run(scheduledSignal, () =>
            this.control.runAgentAction(async () => {
              try {
                await this.backend.command<void>(
                  { method: "setNavigationPolicy", params: { policy } },
                  {
                    abortSignal: scheduledSignal,
                    cancelOperation: true,
                    phase: "navigation-policy",
                  },
                );
              } catch (error) {
                throw normalizeAutomationError(error, "navigation-policy");
              }
            }),
          ),
        ),
    );
    this.navigationGuard = installation.catch(async (error) => {
      let cleanupError: unknown;
      try {
        await this.disconnect();
      } catch (caught) {
        cleanupError = caught;
      }
      throw new BrowserError(
        "Unable to install the browser navigation policy.",
        "transport_failure",
        {
          cause: combineCleanupError(error, cleanupError),
          phase: "navigation-policy",
        },
      );
    });
    void this.navigationGuard.catch(() => undefined);
  }

  async openTab(
    abortSignal: AbortSignal | undefined,
    timeoutMs: number,
  ): Promise<AutomationTabResult> {
    return this.withActionTimeout(abortSignal, timeoutMs, "open-tab", (signal) =>
      this.compatibilityMutex.run(signal, () =>
        this.runContextActionScheduled(signal, "open-tab", (scheduledSignal) =>
          this.backend.command<AutomationTabResult>(
            { method: "openTab", params: {} },
            { abortSignal: scheduledSignal, cancelOperation: true, phase: "open-tab" },
          ),
        ),
      ),
    );
  }

  async selectTab(
    tabId: string,
    abortSignal: AbortSignal | undefined,
    timeoutMs: number,
  ): Promise<AutomationTabResult> {
    this.assertTabUsable(tabId);
    return this.withActionTimeout(abortSignal, timeoutMs, "select-tab", (signal) =>
      this.compatibilityMutex.run(signal, () =>
        this.runContextActionScheduled(signal, "select-tab", (scheduledSignal) =>
          this.backend.command<AutomationTabResult>(
            { method: "selectTab", params: { tabId } },
            { abortSignal: scheduledSignal, cancelOperation: true, phase: "select-tab" },
          ),
        ),
      ),
    );
  }

  async closeTab(
    tabId: string,
    abortSignal: AbortSignal | undefined,
    timeoutMs: number,
  ): Promise<Readonly<{ closedTabId: string; tabs: readonly BrowserTab[] }>> {
    this.assertTabUsable(tabId);
    this.closingTabs.add(tabId);
    let closed = false;
    try {
      const result = await this.withActionTimeout(abortSignal, timeoutMs, "close-tab", (signal) =>
        this.scheduler.run(`tab:${tabId}`, signal, (scheduledSignal) => {
          return this.contextMutex.run(scheduledSignal, () =>
            this.control.runAgentAction(async () => {
              try {
                return await this.backend.command<
                  Readonly<{ closedTabId: string; tabs: readonly BrowserTab[] }>
                >(
                  { method: "closeTab", params: { tabId } },
                  { abortSignal: scheduledSignal, cancelOperation: true, phase: "close-tab" },
                );
              } catch (error) {
                throw normalizeAutomationError(error, "close-tab");
              }
            }),
          );
        }),
      );
      closed = true;
      return result;
    } finally {
      this.closingTabs.delete(tabId);
      if (closed && !this.isClosed) this.rememberClosedTab(tabId);
    }
  }

  async runTabCommand<T>(options: {
    tabId?: string | undefined;
    abortSignal?: AbortSignal | undefined;
    timeoutMs: number;
    phase: string;
    command: (tabId: string) => AutomationCommand;
  }): Promise<T> {
    return this.withActionTimeout(
      options.abortSignal,
      options.timeoutMs,
      options.phase,
      async (signal) => {
        if (options.tabId !== undefined) {
          this.assertTabUsable(options.tabId);
          return this.runScheduledTabCommand(options.tabId, options, signal);
        }
        return this.compatibilityMutex.run(signal, async () => {
          const tabId = await this.selectedTabId(signal);
          this.assertTabUsable(tabId);
          return this.runScheduledTabCommand(tabId, options, signal);
        });
      },
    );
  }

  async disconnect(options: BrowserLifecycleOptions = {}): Promise<void> {
    assertOptionsObject(options);
    if (options.timeoutMs !== undefined) assertPositiveSafeInteger(options.timeoutMs, "timeoutMs");
    if (this.disconnectCompleted) return;
    if (options.abortSignal?.aborted) {
      throw cancellationError(options.abortSignal.reason, "disconnect");
    }
    if (this.disconnectPromise !== undefined) {
      return waitForSharedDisconnect(this.disconnectPromise, options);
    }
    this.markClosed();
    const promise = this.backend.disconnect(options);
    this.disconnectPromise = promise;
    try {
      await promise;
      this.disconnectCompleted = true;
    } finally {
      if (this.disconnectPromise === promise) this.disconnectPromise = undefined;
    }
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.disconnect();
  }

  private async runScheduledTabCommand<T>(
    tabId: string,
    options: {
      abortSignal?: AbortSignal | undefined;
      timeoutMs: number;
      phase: string;
      command: (tabId: string) => AutomationCommand;
    },
    abortSignal: AbortSignal,
  ): Promise<T> {
    return this.scheduler.run(`tab:${tabId}`, abortSignal, (scheduledSignal) =>
      this.control.runAgentAction(async () => {
        await waitForOwnedPromise(this.navigationGuard, scheduledSignal);
        try {
          return await this.backend.command<T>(options.command(tabId), {
            abortSignal: scheduledSignal,
            cancelOperation: true,
            phase: options.phase,
          });
        } catch (error) {
          throw normalizeAutomationError(error, options.phase);
        }
      }),
    );
  }

  private async selectedTabId(abortSignal: AbortSignal): Promise<string> {
    const tabs = await this.runContextActionScheduled(
      abortSignal,
      "selected-tab-lookup",
      (signal) =>
        this.backend.command<readonly BrowserTab[]>(
          { method: "listTabs", params: {} },
          { abortSignal: signal, cancelOperation: true, phase: "selected-tab-lookup" },
        ),
    );
    const selected = tabs.find((tab) => tab.selected) ?? tabs[0];
    if (selected === undefined) {
      throw new BrowserError("Browser has no open tabs.", "invalid_state", {
        phase: "selected-tab-lookup",
      });
    }
    return selected.id;
  }

  private runContextAction<T>(
    abortSignal: AbortSignal | undefined,
    timeoutMs: number,
    phase: string,
    operation: (abortSignal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    return this.withActionTimeout(abortSignal, timeoutMs, phase, (signal) =>
      this.runContextActionScheduled(signal, phase, operation),
    );
  }

  private runContextActionScheduled<T>(
    abortSignal: AbortSignal,
    phase: string,
    operation: (abortSignal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    return this.scheduler.run("browser-context", abortSignal, (scheduledSignal) =>
      this.contextMutex.run(scheduledSignal, () =>
        this.control.runAgentAction(async () => {
          this.assertOpen();
          await waitForOwnedPromise(this.navigationGuard, scheduledSignal);
          try {
            return await operation(scheduledSignal);
          } catch (error) {
            throw normalizeAutomationError(error, phase);
          }
        }),
      ),
    );
  }

  private async withActionTimeout<T>(
    abortSignal: AbortSignal | undefined,
    timeoutMs: number,
    phase: string,
    operation: (abortSignal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    assertPositiveSafeInteger(timeoutMs, "timeoutMs");
    if (abortSignal?.aborted) throw cancellationError(abortSignal.reason, phase);
    const timeoutController = new AbortController();
    const timer = setTimeout(
      () =>
        timeoutController.abort(
          new BrowserError("Browser action timed out.", "action_timeout", { phase }),
        ),
      timeoutMs,
    );
    timer.unref?.();
    const effectiveSignal =
      abortSignal === undefined
        ? timeoutController.signal
        : AbortSignal.any([abortSignal, timeoutController.signal]);
    try {
      const value = await operation(effectiveSignal);
      if (abortSignal?.aborted) throw cancellationError(abortSignal.reason, phase);
      if (timeoutController.signal.aborted) throw timeoutController.signal.reason;
      return value;
    } catch (error) {
      if (abortSignal?.aborted) throw cancellationError(abortSignal.reason, phase);
      if (timeoutController.signal.aborted) throw timeoutController.signal.reason;
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private assertTabUsable(tabId: string): void {
    this.assertOpen();
    if (this.closingTabs.has(tabId) || this.closedTabs.has(tabId)) {
      throw new BrowserError(`Browser tab is closing or closed: ${tabId}`, "invalid_state", {
        phase: "tab-lookup",
      });
    }
  }

  private rememberClosedTab(tabId: string): void {
    this.closedTabs.add(tabId);
    if (this.closedTabs.size <= maxClosedTabTombstones) return;
    const oldest = this.closedTabs.values().next().value;
    if (oldest !== undefined) this.closedTabs.delete(oldest);
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new BrowserError("Browser connection is closed.", "connection_closed");
    }
  }

  private markClosed(): void {
    if (this.isClosed) return;
    this.isClosed = true;
    const error = new BrowserError("Browser connection is closed.", "connection_closed");
    this.scheduler.close(error);
    this.compatibilityMutex.close(error);
    this.contextMutex.close(error);
    this.closingTabs.clear();
    this.closedTabs.clear();
    this.removeDisconnectedListener?.();
    this.removeDisconnectedListener = undefined;
    this.onClosed?.(this);
  }
}

function normalizeScheduling(
  value: BrowserConnectOptions["scheduling"],
): ConstructorParameters<typeof ResourceScheduler>[0] {
  if (value === undefined) {
    return {
      mode: "serial",
      maxConcurrentResources: 1,
      maxQueuedActions: defaultMaxQueuedActions,
    };
  }
  assertOptionsObject(value);
  const maxQueuedActions = value.maxQueuedActions ?? defaultMaxQueuedActions;
  assertPositiveSafeInteger(maxQueuedActions, "scheduling.maxQueuedActions");
  if (value.mode === "serial") {
    return { mode: "serial", maxConcurrentResources: 1, maxQueuedActions };
  }
  if (value.mode !== "per-tab") throw new TypeError("Unsupported browser scheduling mode.");
  const maxConcurrentResources = value.maxConcurrentTabs ?? defaultMaxConcurrentTabs;
  assertPositiveSafeInteger(maxConcurrentResources, "scheduling.maxConcurrentTabs");
  return { mode: "per-tab", maxConcurrentResources, maxQueuedActions };
}

function normalizeAutomationError(error: unknown, phase: string): BrowserError {
  if (error instanceof BrowserError) return error;
  if (error instanceof Error && /ERR_BLOCKED_BY_CLIENT|blockedbyclient/i.test(error.message)) {
    return new BrowserError("Browser navigation was rejected by policy.", "navigation_blocked", {
      cause: error,
      phase,
    });
  }
  if (error instanceof Error && error.name === "TimeoutError") {
    return new BrowserError("Browser action timed out.", "action_timeout", {
      cause: error,
      phase,
    });
  }
  if (
    error instanceof Error &&
    /tab does not exist|has no open tabs|target page.*closed|page has been closed/i.test(
      error.message,
    )
  ) {
    return new BrowserError(error.message, "invalid_state", { cause: error, phase });
  }
  if (
    error instanceof Error &&
    /browser.*closed|disconnected|connection.*closed|websocket.*closed/i.test(error.message)
  ) {
    return new BrowserError("Browser automation connection closed.", "connection_closed", {
      cause: error,
      phase,
    });
  }
  return new BrowserError("Browser tool operation failed.", "tool_failed", {
    cause: error,
    phase,
  });
}

function assertPositiveSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maxTimerMs) {
    throw new RangeError(`${name} must be a positive integer no greater than ${maxTimerMs}.`);
  }
}

function assertOptionsObject(value: unknown): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("options must be an object.");
  }
}

function combineCleanupError(error: unknown, cleanupError: unknown): unknown {
  return cleanupError === undefined
    ? error
    : new AggregateError([error, cleanupError], "Browser automation cleanup also failed.");
}

async function waitForOwnedPromise<T>(promise: Promise<T>, abortSignal: AbortSignal): Promise<T> {
  abortSignal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      abortSignal.removeEventListener("abort", abort);
      callback();
    };
    const abort = () => finish(() => reject(abortSignal.reason));
    abortSignal.addEventListener("abort", abort, { once: true });
    void promise.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
  });
}

async function waitForSharedDisconnect(
  promise: Promise<void>,
  options: BrowserLifecycleOptions,
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  assertPositiveSafeInteger(timeoutMs, "timeoutMs");
  if (options.abortSignal?.aborted) {
    throw cancellationError(options.abortSignal.reason, "disconnect");
  }
  const controller = new AbortController();
  const timer = setTimeout(
    () =>
      controller.abort(
        new BrowserError("Browser disconnect timed out.", "connection_timeout", {
          phase: "disconnect",
        }),
      ),
    timeoutMs,
  );
  timer.unref?.();
  const signal =
    options.abortSignal === undefined
      ? controller.signal
      : AbortSignal.any([options.abortSignal, controller.signal]);
  try {
    await waitForOwnedPromise(promise, signal);
  } catch (error) {
    if (options.abortSignal?.aborted) {
      throw cancellationError(options.abortSignal.reason, "disconnect");
    }
    if (controller.signal.aborted) throw controller.signal.reason;
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export type { AutomationBackend };

export function asConnection(
  connection: PlaywrightBrowserConnection,
): PlaywrightBrowserConnectionImpl {
  if (!(connection instanceof PlaywrightBrowserConnectionImpl)) {
    throw new TypeError("connection must be created by DockerBrowser.connect().");
  }
  return connection;
}
