import type {
  DockerSandbox,
  DockerSandboxInspectionOptions,
  DockerSandboxInspector,
  DockerSandboxState,
} from "@anvia/sandbox";
import { connectPlaywrightBrowser, type PlaywrightBrowserConnectionImpl } from "./connection";
import { BrowserControlState } from "./control";
import { BrowserError, cancellationError } from "./errors";
import {
  assertOptionsObject,
  assertPositiveSafeInteger,
  boundedSignal,
  defaultLifecycleTimeoutMs,
  validateLifecycleOptions,
  waitForSharedLifecycle,
} from "./lifecycle";
import {
  browserCapabilities,
  cdpPort,
  endpointFor,
  normalizeReadinessError,
  noVncPort,
  probeBrowserCapability,
} from "./readiness";
import type {
  BrowserCapability,
  BrowserCapabilitySnapshot,
  BrowserConnectOptions,
  BrowserDesktopEndpoint,
  BrowserLifecycleOptions,
  BrowserReadinessSnapshot,
  BrowserWaitUntilReadyOptions,
  DockerBrowser,
  PlaywrightBrowserConnection,
} from "./types";

const defaultConnectTimeoutMs = 30_000;
const capabilities = browserCapabilities;

type OwnedOperation = {
  controller: AbortController;
  promise: Promise<unknown>;
};

type HandleState = "active" | "stopping" | "stopped" | "destroying" | "destroyed" | "error";

export class DockerBrowserHandle implements DockerBrowser {
  readonly id: string;
  readonly sandbox: DockerSandbox;
  readonly desktop: BrowserDesktopEndpoint;
  private readonly control = new BrowserControlState();
  private readonly connections = new Set<PlaywrightBrowserConnectionImpl>();
  private readonly ownedOperations = new Set<OwnedOperation>();
  private readonly capabilityStates = new Map<BrowserCapability, BrowserCapabilitySnapshot>(
    capabilities.map((capability) => [capability, Object.freeze({ capability, state: "unknown" })]),
  );
  private readonly capabilityGenerations = new Map<BrowserCapability, number>(
    capabilities.map((capability) => [capability, 0]),
  );
  private handleState: HandleState = "active";
  private connectionPending = false;
  private stopPromise: Promise<void> | undefined;
  private destroyPromise: Promise<void> | undefined;
  private readonly connectBrowser: typeof connectPlaywrightBrowser;

  constructor(
    sandbox: DockerSandbox,
    connectBrowser: typeof connectPlaywrightBrowser = connectPlaywrightBrowser,
  ) {
    this.sandbox = sandbox;
    this.id = sandbox.id;
    this.connectBrowser = connectBrowser;
    this.desktop = Object.freeze({
      protocol: "novnc",
      containerPort: noVncPort,
      control: this.control,
    });
  }

  get state(): DockerSandboxState {
    return this.handleState === "active" ? this.sandbox.state : this.handleState;
  }

  inspector(options: DockerSandboxInspectionOptions): DockerSandboxInspector {
    return this.sandbox.inspector(options);
  }

  readiness(): BrowserReadinessSnapshot {
    const terminal =
      this.handleState === "destroyed" || this.handleState === "destroying"
        ? "destroyed"
        : this.handleState === "stopped" || this.handleState === "stopping"
          ? "stopped"
          : undefined;
    const entries = Object.fromEntries(
      capabilities.map((capability) => {
        const current = this.capabilityStates.get(capability)!;
        return [
          capability,
          terminal === undefined
            ? current
            : Object.freeze({ capability, state: terminal } satisfies BrowserCapabilitySnapshot),
        ];
      }),
    ) as Record<BrowserCapability, BrowserCapabilitySnapshot>;
    const values = Object.values(entries);
    const state =
      this.handleState === "error"
        ? "failed"
        : (terminal ??
          (values.some((value) => value.state === "checking")
            ? "checking"
            : values.every((value) => value.state === "unknown")
              ? "unknown"
              : values.every((value) => value.state === "ready")
                ? "ready"
                : values.some((value) => value.state === "failed")
                  ? values.some((value) => value.state === "ready")
                    ? "degraded"
                    : "failed"
                  : "partial"));
    return Object.freeze({ state, capabilities: Object.freeze(entries) });
  }

  async waitForCapabilities(
    options: BrowserWaitUntilReadyOptions,
  ): Promise<BrowserReadinessSnapshot> {
    validateReadinessOptions(options);
    this.assertRunning();
    if (options.abortSignal?.aborted) {
      throw cancellationError(options.abortSignal.reason, "readiness");
    }
    const requested = options.capabilities ?? capabilities;
    const ownedController = new AbortController();
    const timeoutController = new AbortController();
    const deadline = Date.now() + options.timeoutMs;
    const timer = setTimeout(
      () =>
        timeoutController.abort(
          new BrowserError("Browser readiness timed out.", "readiness_timeout", {
            phase: "readiness",
          }),
        ),
      options.timeoutMs,
    );
    timer.unref?.();
    const signals = [ownedController.signal, timeoutController.signal];
    if (options.abortSignal !== undefined) signals.push(options.abortSignal);
    const abortSignal = AbortSignal.any(signals);
    const previous = new Map(
      requested.map((capability) => [capability, this.capabilityStates.get(capability)!]),
    );
    const generations = new Map(
      requested.map((capability) => {
        const generation = (this.capabilityGenerations.get(capability) ?? 0) + 1;
        this.capabilityGenerations.set(capability, generation);
        return [capability, generation] as const;
      }),
    );
    for (const capability of requested) this.setCapability(capability, "checking");

    const promise = Promise.allSettled(
      requested.map(async (capability) => {
        try {
          await probeBrowserCapability({
            capability,
            sandbox: this.sandbox,
            control: this.control,
            connectBrowser: this.connectBrowser,
            abortSignal,
            deadline,
          });
          abortSignal.throwIfAborted();
          if (this.capabilityGenerations.get(capability) === generations.get(capability)) {
            this.setCapability(capability, "ready");
          }
        } catch (error) {
          const normalized = normalizeReadinessError(error, capability, {
            callerAborted: options.abortSignal?.aborted === true,
            timedOut: timeoutController.signal.aborted,
          });
          if (this.capabilityGenerations.get(capability) === generations.get(capability)) {
            if (options.abortSignal?.aborted) {
              this.capabilityStates.set(capability, previous.get(capability)!);
            } else {
              this.setCapability(capability, "failed", normalized);
            }
          }
          throw normalized;
        }
      }),
    );
    const owned = { controller: ownedController, promise };
    this.ownedOperations.add(owned);
    try {
      const results = await promise;
      if (options.abortSignal?.aborted) {
        throw cancellationError(options.abortSignal.reason, "readiness");
      }
      const failures = results.filter(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );
      this.updateControlAvailability();
      if (failures.length > 0) throw failures[0]!.reason;
      return this.readiness();
    } finally {
      clearTimeout(timer);
      this.ownedOperations.delete(owned);
    }
  }

  async waitUntilReady(options: BrowserWaitUntilReadyOptions): Promise<void> {
    await this.waitForCapabilities(options);
  }

  async connect(options: BrowserConnectOptions = {}): Promise<PlaywrightBrowserConnection> {
    assertOptionsObject(options);
    if (options.timeoutMs !== undefined) assertPositiveSafeInteger(options.timeoutMs, "timeoutMs");
    this.assertRunning();
    if (options.abortSignal?.aborted) {
      throw cancellationError(options.abortSignal.reason, "connect");
    }
    if (this.connectionPending || this.connections.size > 0) {
      throw new BrowserError(
        "Browser already has an active or pending automation connection.",
        "agent_action_busy",
        { phase: "connect" },
      );
    }
    this.connectionPending = true;
    const controller = new AbortController();
    const signals = [controller.signal];
    if (options.abortSignal !== undefined) signals.push(options.abortSignal);
    const abortSignal = AbortSignal.any(signals);
    let owned!: OwnedOperation;
    const promise = (async () => {
      // Register the operation before endpoint resolution or the connection factory can fail.
      await Promise.resolve();
      try {
        abortSignal.throwIfAborted();
        const connection = await this.connectBrowser({
          endpointUrl: endpointFor(this.sandbox, cdpPort),
          control: this.control,
          timeoutMs: options.timeoutMs ?? defaultConnectTimeoutMs,
          abortSignal,
          scheduling: options.scheduling,
          onClosed: (closedConnection) => this.connections.delete(closedConnection),
        });
        this.connections.add(connection);
        const disconnectedDuringInitialization = connection.closed;
        if (
          disconnectedDuringInitialization ||
          this.handleState !== "active" ||
          this.state !== "running"
        ) {
          this.connections.delete(connection);
          let cleanupError: unknown;
          try {
            await connection.disconnect();
          } catch (caught) {
            cleanupError = caught;
          }
          if (
            disconnectedDuringInitialization &&
            this.handleState === "active" &&
            this.state === "running"
          ) {
            throw new BrowserError(
              "Browser disconnected while automation was initializing.",
              "connection_closed",
              {
                ...(cleanupError === undefined ? {} : { cause: cleanupError }),
                phase: "connect",
              },
            );
          }
          const lifecycleError = this.lifecycleError(
            "Browser stopped while the connection was initializing.",
          );
          throw cleanupError === undefined
            ? lifecycleError
            : new BrowserError(lifecycleError.message, lifecycleError.code, {
                cause: cleanupError,
                ...(lifecycleError.phase === undefined ? {} : { phase: lifecycleError.phase }),
              });
        }
        return connection;
      } catch (error) {
        if (options.abortSignal?.aborted) {
          throw cancellationError(options.abortSignal.reason, "connect");
        }
        if (controller.signal.aborted) throw controller.signal.reason;
        if (error instanceof BrowserError) throw error;
        throw new BrowserError("Unable to connect to Chromium over CDP.", "transport_failure", {
          cause: error,
          phase: "connect",
        });
      } finally {
        this.connectionPending = false;
        this.ownedOperations.delete(owned);
      }
    })();
    owned = { controller, promise };
    this.ownedOperations.add(owned);
    return promise;
  }

  async stop(options: BrowserLifecycleOptions = {}): Promise<void> {
    assertOptionsObject(options);
    if (this.handleState === "stopped") return;
    if (this.handleState === "destroyed" || this.handleState === "destroying") {
      throw new BrowserError("Browser runtime is destroyed.", "runtime_destroyed");
    }
    validateLifecycleOptions(options, "stop-browser");
    if (this.stopPromise !== undefined) {
      return waitForSharedLifecycle(this.stopPromise, options, "stop-browser");
    }
    this.handleState = "stopping";
    this.control.setAvailability("disconnected");
    const promise = this.performStop(options);
    this.stopPromise = promise;
    try {
      await promise;
    } finally {
      if (this.stopPromise === promise) this.stopPromise = undefined;
    }
  }

  async destroy(options: BrowserLifecycleOptions = {}): Promise<void> {
    assertOptionsObject(options);
    if (this.handleState === "destroyed") return;
    validateLifecycleOptions(options, "destroy-browser");
    if (this.destroyPromise === undefined) {
      this.handleState = "destroying";
      this.control.destroy();
      const activeStop = this.stopPromise;
      const promise = (async () => {
        if (activeStop !== undefined) await activeStop.catch(() => undefined);
        await this.performDestroy();
      })();
      this.destroyPromise = promise;
      void promise.then(
        () => {
          if (this.destroyPromise === promise) this.destroyPromise = undefined;
        },
        () => {
          if (this.destroyPromise === promise) this.destroyPromise = undefined;
        },
      );
    }
    return waitForSharedLifecycle(this.destroyPromise, options, "destroy-browser");
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.destroy();
  }

  private async performStop(options: BrowserLifecycleOptions): Promise<void> {
    const bounded = boundedSignal(options, defaultLifecycleTimeoutMs, "stop-browser");
    try {
      await this.abortOwnedOperations(
        new BrowserError("Browser runtime is stopping.", "connection_closed", {
          phase: "stop-browser",
        }),
      );
      const disconnectFailures = await this.disconnectAll({ abortSignal: bounded.signal });
      await this.sandbox.stop({ abortSignal: bounded.signal });
      if (this.handleState === "stopping") this.handleState = "stopped";
      bounded.throwIfAborted();
      if (disconnectFailures.length > 0) {
        throw new BrowserError(
          "Browser stopped, but one or more automation workers failed to disconnect.",
          "transport_failure",
          {
            cause: new AggregateError(disconnectFailures, "Automation worker cleanup failed."),
            phase: "stop-browser",
            recovery: "restart",
          },
        );
      }
    } catch (error) {
      if (this.handleState === "stopping") this.handleState = "error";
      throw bounded.normalize(error, "Unable to stop browser runtime.", "transport_failure");
    } finally {
      bounded.dispose();
    }
  }

  private async performDestroy(): Promise<void> {
    try {
      await this.abortOwnedOperations(
        new BrowserError("Browser runtime was destroyed.", "runtime_destroyed", {
          phase: "destroy-browser",
        }),
      );
      const disconnectFailures = await this.disconnectAll({});
      await this.sandbox.destroy();
      this.handleState = "destroyed";
      if (disconnectFailures.length > 0) {
        throw new BrowserError(
          "Browser was destroyed, but one or more automation workers failed to disconnect.",
          "transport_failure",
          {
            cause: new AggregateError(disconnectFailures, "Automation worker cleanup failed."),
            phase: "destroy-browser",
            retryable: false,
            recovery: "none",
          },
        );
      }
    } catch (error) {
      if (this.handleState !== "destroyed") this.handleState = "error";
      if (error instanceof BrowserError) throw error;
      throw new BrowserError("Unable to destroy browser runtime.", "transport_failure", {
        cause: error,
        phase: "destroy-browser",
        recovery: "retry",
      });
    }
  }

  private assertRunning(): void {
    if (this.handleState === "destroyed" || this.handleState === "destroying") {
      throw new BrowserError("Browser runtime is destroyed.", "runtime_destroyed");
    }
    if (this.handleState !== "active" || this.state !== "running") {
      throw new BrowserError(`Browser is not running: ${this.state}`, "invalid_state");
    }
  }

  private lifecycleError(message: string): BrowserError {
    return this.handleState === "destroying" || this.handleState === "destroyed"
      ? new BrowserError(message, "runtime_destroyed")
      : new BrowserError(message, "connection_closed", { phase: "connect" });
  }

  private async abortOwnedOperations(error: BrowserError): Promise<void> {
    const operations = [...this.ownedOperations];
    for (const operation of operations) operation.controller.abort(error);
    await Promise.allSettled(operations.map((operation) => operation.promise));
  }

  private async disconnectAll(options: BrowserLifecycleOptions): Promise<readonly unknown[]> {
    const connections = [...this.connections];
    this.connections.clear();
    const results = await Promise.allSettled(
      connections.map((connection) => connection.disconnect(options)),
    );
    return results
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => result.reason);
  }

  private setCapability(
    capability: BrowserCapability,
    state: BrowserCapabilitySnapshot["state"],
    error?: BrowserError,
  ): void {
    this.capabilityStates.set(
      capability,
      Object.freeze({
        capability,
        state,
        checkedAt: new Date().toISOString(),
        ...(error === undefined ? {} : { error }),
      }),
    );
  }

  private updateControlAvailability(): void {
    if (this.handleState !== "active" || this.state !== "running") {
      this.control.setAvailability("disconnected");
      return;
    }
    const failed = capabilities.some(
      (capability) => this.capabilityStates.get(capability)?.state === "failed",
    );
    this.control.setAvailability(failed ? "degraded" : "available");
  }
}

function validateReadinessOptions(options: BrowserWaitUntilReadyOptions): void {
  assertOptionsObject(options);
  assertPositiveSafeInteger(options.timeoutMs, "timeoutMs");
  if (options.capabilities === undefined) return;
  if (!Array.isArray(options.capabilities) || options.capabilities.length === 0) {
    throw new TypeError("capabilities must be a non-empty array.");
  }
  const unique = new Set<BrowserCapability>();
  for (const capability of options.capabilities) {
    if (!capabilities.includes(capability)) {
      throw new TypeError(`Unsupported browser capability: ${capability}`);
    }
    if (unique.has(capability)) throw new TypeError(`Duplicate browser capability: ${capability}`);
    unique.add(capability);
  }
}
