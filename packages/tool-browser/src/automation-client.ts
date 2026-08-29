import { fork, type ChildProcess } from "node:child_process";
import type { AutomationCommand, AutomationRequest, SerializedError } from "./automation-protocol";
import { isAutomationResponse } from "./automation-protocol";
import { BrowserError, cancellationError } from "./errors";
import type { BrowserLifecycleOptions } from "./types";

type PendingRequest = {
  state: "active" | "cancelling";
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  abortSignal?: AbortSignal;
  abort?: () => void;
  abortError?: unknown;
  cleanupTimer?: ReturnType<typeof setTimeout>;
};

export type AutomationCommandOptions = Readonly<{
  abortSignal?: AbortSignal;
  cancelOperation?: boolean;
  phase: string;
}>;

export interface AutomationBackend {
  readonly closed: boolean;
  command<T>(command: AutomationCommand, options: AutomationCommandOptions): Promise<T>;
  disconnect(options?: BrowserLifecycleOptions): Promise<void>;
  onDisconnected(listener: () => void): () => void;
}

export type AutomationWorkerFactory = () => ChildProcess;

const cancellationCleanupTimeoutMs = 5_000;
const workerTerminationTimeoutMs = 3_000;
const maxWorkerStderrChars = 32_768;

export class AutomationWorkerClient implements AutomationBackend {
  private readonly child: ChildProcess;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly disconnectedListeners = new Set<() => void>();
  private nextId = 1;
  private isClosed = false;
  private disconnecting = false;
  private termination: Promise<void> | undefined;
  private workerStderr = "";
  private readonly onStderrData = (chunk: string) => {
    this.workerStderr = `${this.workerStderr}${chunk}`.slice(-maxWorkerStderrChars);
  };
  private readonly onStderrError = () => {
    // The diagnostics pipe is optional; its failure must not crash the host process.
  };
  private readonly onMessage = (message: unknown) => {
    try {
      this.handleMessage(message);
    } catch (error) {
      this.handleExit(
        new BrowserError(
          "Browser automation worker sent an invalid response.",
          "transport_failure",
          {
            cause: error,
            phase: "automation-worker",
          },
        ),
      );
      void this.terminate().catch(() => undefined);
    }
  };
  private readonly onError = (error: Error) => {
    this.handleExit(error);
    void this.terminate().catch(() => undefined);
  };
  private readonly onExit = (code: number | null, signal: NodeJS.Signals | null) => {
    const diagnostics = this.workerStderr.trim();
    this.handleExit(
      new Error(
        `Browser automation worker exited: code=${code ?? "null"} signal=${signal ?? "null"}${diagnostics.length === 0 ? "" : `\n${diagnostics}`}`,
      ),
    );
  };

  private constructor(factory: AutomationWorkerFactory) {
    this.child = factory();
    this.child.stderr?.setEncoding("utf8");
    this.child.stderr?.on("data", this.onStderrData);
    this.child.stderr?.on("error", this.onStderrError);
    this.child.on("message", this.onMessage);
    this.child.on("error", this.onError);
    this.child.once("exit", this.onExit);
  }

  static async connect(options: {
    endpointUrl: string;
    timeoutMs: number;
    abortSignal?: AbortSignal;
    workerFactory?: AutomationWorkerFactory;
  }): Promise<AutomationWorkerClient> {
    assertPositiveSafeInteger(options.timeoutMs, "timeoutMs");
    if (options.abortSignal?.aborted) {
      throw cancellationError(options.abortSignal.reason, "connect");
    }
    let client: AutomationWorkerClient;
    try {
      client = new AutomationWorkerClient(options.workerFactory ?? spawnAutomationWorker);
    } catch (error) {
      throw new BrowserError(
        "Unable to start the browser automation worker.",
        "transport_failure",
        {
          cause: error,
          phase: "connect",
          recovery: "reconnect",
        },
      );
    }
    const timeoutController = new AbortController();
    const timer = setTimeout(
      () =>
        timeoutController.abort(
          new BrowserError(
            "Browser connection did not initialize before the timeout.",
            "connection_timeout",
            { phase: "connect" },
          ),
        ),
      options.timeoutMs,
    );
    timer.unref?.();
    const abortSignal =
      options.abortSignal === undefined
        ? timeoutController.signal
        : AbortSignal.any([options.abortSignal, timeoutController.signal]);
    try {
      await client.command(
        {
          method: "connect",
          params: { endpointUrl: options.endpointUrl, timeoutMs: options.timeoutMs },
        },
        { abortSignal, phase: "connect" },
      );
      return client;
    } catch (error) {
      await client.terminate();
      if (options.abortSignal?.aborted) {
        throw cancellationError(options.abortSignal.reason, "connect");
      }
      if (timeoutController.signal.aborted) throw timeoutController.signal.reason;
      if (
        error instanceof Error &&
        (error.name === "TimeoutError" || /timeout/i.test(error.message))
      ) {
        throw new BrowserError(
          "Browser connection did not initialize before the timeout.",
          "connection_timeout",
          { cause: error, phase: "connect" },
        );
      }
      throw new BrowserError("Unable to initialize browser automation.", "transport_failure", {
        cause: error,
        phase: "connect",
      });
    } finally {
      clearTimeout(timer);
    }
  }

  get closed(): boolean {
    return this.isClosed || this.child.exitCode !== null || this.child.signalCode !== null;
  }

  command<T>(command: AutomationCommand, options: AutomationCommandOptions): Promise<T> {
    if (this.closed) {
      return Promise.reject(
        new BrowserError("Browser automation connection is closed.", "connection_closed", {
          phase: options.phase,
        }),
      );
    }
    if (options.abortSignal?.aborted) {
      return Promise.reject(this.abortError(options.abortSignal, options.phase));
    }
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const pending: PendingRequest = {
        state: "active",
        resolve: (value) => resolve(value as T),
        reject,
      };
      if (options.abortSignal !== undefined) {
        pending.abortSignal = options.abortSignal;
        pending.abort = () => this.cancelRequest(id, pending, options);
        options.abortSignal.addEventListener("abort", pending.abort, { once: true });
      }
      this.pending.set(id, pending);
      const request: AutomationRequest = { kind: "request", id, ...command };
      try {
        this.child.send(request, (error) => {
          if (error == null) return;
          this.rejectSend(options.phase, error);
        });
      } catch (error) {
        this.rejectSend(options.phase, error);
      }
    });
  }

  async disconnect(options: BrowserLifecycleOptions = {}): Promise<void> {
    if (this.termination !== undefined) return this.termination;
    this.disconnecting = true;
    const timeoutMs = options.timeoutMs ?? 10_000;
    const timeoutController = new AbortController();
    const timer = setTimeout(
      () =>
        timeoutController.abort(
          new BrowserError("Browser disconnect timed out.", "connection_timeout", {
            phase: "disconnect",
          }),
        ),
      timeoutMs,
    );
    timer.unref?.();
    const abortSignal =
      options.abortSignal === undefined
        ? timeoutController.signal
        : AbortSignal.any([options.abortSignal, timeoutController.signal]);
    try {
      if (!this.closed) {
        await this.command(
          { method: "disconnect", params: {} },
          { abortSignal, phase: "disconnect" },
        );
      }
    } catch (error) {
      if (options.abortSignal?.aborted) {
        throw cancellationError(options.abortSignal.reason, "disconnect");
      }
      if (timeoutController.signal.aborted) throw timeoutController.signal.reason;
      if (!this.closed) throw error;
    } finally {
      clearTimeout(timer);
      await this.terminate();
    }
  }

  onDisconnected(listener: () => void): () => void {
    if (this.closed) {
      queueMicrotask(() => {
        try {
          listener();
        } catch {
          // A closed backend must not surface callback failures through the host event loop.
        }
      });
      return () => undefined;
    }
    this.disconnectedListeners.add(listener);
    return () => this.disconnectedListeners.delete(listener);
  }

  async terminate(): Promise<void> {
    if (this.termination !== undefined) return this.termination;
    this.termination = this.performTerminate();
    return this.termination;
  }

  private async performTerminate(): Promise<void> {
    this.isClosed = true;
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    const exited = new Promise<void>((resolve) => this.child.once("exit", () => resolve()));
    this.child.kill("SIGTERM");
    let forceTimer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      exited,
      new Promise<void>((resolve) => {
        forceTimer = setTimeout(() => {
          this.child.kill("SIGKILL");
          resolve();
        }, workerTerminationTimeoutMs);
        forceTimer.unref?.();
      }),
    ]);
    if (forceTimer !== undefined) clearTimeout(forceTimer);
    if (this.child.exitCode === null && this.child.signalCode === null) await exited;
  }

  private cancelRequest(
    id: number,
    pending: PendingRequest,
    options: AutomationCommandOptions,
  ): void {
    if (pending.state !== "active") return;
    pending.state = "cancelling";
    pending.abortError = this.abortError(pending.abortSignal!, options.phase);
    if (options.cancelOperation === true && this.child.connected) {
      try {
        this.child.send({ kind: "cancel", id }, (error) => {
          if (error !== null) void this.terminate().catch(() => undefined);
        });
      } catch {
        void this.terminate().catch(() => undefined);
        return;
      }
      pending.cleanupTimer = setTimeout(() => {
        void this.terminate().catch(() => undefined);
      }, cancellationCleanupTimeoutMs);
      pending.cleanupTimer.unref?.();
      return;
    }
    void this.terminate().catch(() => undefined);
  }

  private abortError(abortSignal: AbortSignal, phase: string): unknown {
    return abortSignal.reason instanceof BrowserError
      ? abortSignal.reason
      : cancellationError(abortSignal.reason, phase);
  }

  private handleMessage(message: unknown): void {
    if (!isAutomationResponse(message)) {
      throw new TypeError("Invalid browser automation worker response.");
    }
    if (message.kind === "event") {
      if (!this.disconnecting) {
        this.handleExit(
          new BrowserError("Browser disconnected from CDP.", "connection_closed", {
            phase: "automation-event",
          }),
        );
        void this.terminate().catch(() => undefined);
      }
      return;
    }
    const pending = this.pending.get(message.id);
    if (pending === undefined) return;
    if (message.kind === "cancelled") {
      if (pending.state === "cancelling") {
        this.settle(message.id, pending, () => pending.reject(pending.abortError));
      }
      return;
    }
    if (pending.state === "cancelling") return;
    this.settle(message.id, pending, () => {
      if (message.ok) pending.resolve(message.value);
      else pending.reject(deserializeError(message.error));
    });
  }

  private handleExit(cause: unknown): void {
    if (this.isClosed && this.pending.size === 0) {
      this.cleanupChildListeners();
      return;
    }
    this.isClosed = true;
    const error =
      cause instanceof BrowserError
        ? cause
        : new BrowserError("Browser automation worker terminated.", "transport_failure", {
            cause,
            phase: "automation-worker",
          });
    for (const [id, pending] of this.pending) {
      this.settle(id, pending, () =>
        pending.reject(pending.state === "cancelling" ? pending.abortError : error),
      );
    }
    const listeners = [...this.disconnectedListeners];
    this.disconnectedListeners.clear();
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        // Connection teardown must not throw from a child-process event callback.
      }
    }
    this.cleanupChildListeners();
  }

  private cleanupChildListeners(): void {
    this.child.off("message", this.onMessage);
    this.child.off("exit", this.onExit);
    this.child.stderr?.off("data", this.onStderrData);
  }

  private rejectSend(phase: string, cause: unknown): void {
    this.handleExit(
      new BrowserError("Unable to send browser automation command.", "transport_failure", {
        cause,
        phase,
      }),
    );
    void this.terminate().catch(() => undefined);
  }

  private settle(id: number, pending: PendingRequest, callback: () => void): void {
    if (this.pending.get(id) !== pending) return;
    this.pending.delete(id);
    if (pending.cleanupTimer !== undefined) clearTimeout(pending.cleanupTimer);
    if (pending.abort !== undefined) {
      pending.abortSignal?.removeEventListener("abort", pending.abort);
    }
    callback();
  }
}

function spawnAutomationWorker(): ChildProcess {
  return fork(automationWorkerUrl(), [], {
    execArgv: [],
    serialization: "advanced",
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
}

function automationWorkerUrl(): URL {
  return import.meta.url.endsWith("/src/automation-client.ts")
    ? new URL("../dist/automation-worker.js", import.meta.url)
    : new URL("./automation-worker.js", import.meta.url);
}

function deserializeError(value: SerializedError): Error {
  const error = new Error(value.message);
  error.name = value.name;
  if (value.stack !== undefined) error.stack = value.stack;
  if (value.code !== undefined) Object.assign(error, { code: value.code });
  return error;
}

function assertPositiveSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 2_147_483_647) {
    throw new RangeError(`${name} must be a positive integer no greater than 2147483647.`);
  }
}
