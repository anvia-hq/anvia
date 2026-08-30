import { EventEmitter } from "node:events";
import { fork, spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AutomationRequest, AutomationResponse } from "../src/automation-protocol";
import { type AutomationBackend, AutomationWorkerClient } from "../src/automation-client";
import { PlaywrightBrowserConnectionImpl } from "../src/connection";
import { BrowserControlState } from "../src/control";

describe("AutomationWorkerClient connection lifecycle", () => {
  afterEach(() => vi.useRealTimers());

  it("establishes and explicitly disconnects a successful connection", async () => {
    const child = new FakeChild((message) => {
      if (message.method === "connect") child.respond(success(message.id));
      if (message.method === "disconnect") child.respond(success(message.id));
    });
    const client = await AutomationWorkerClient.connect({
      endpointUrl: "http://127.0.0.1:9222",
      timeoutMs: 1_000,
      workerFactory: () => child.asChildProcess(),
    });

    expect(client.closed).toBe(false);
    await client.disconnect();
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(client.closed).toBe(true);
    expect(child.listenerCount("message")).toBe(0);
    expect(child.listenerCount("error")).toBe(0);
    expect(child.listenerCount("exit")).toBe(0);
  });

  it("owns and terminates an attempt that times out before transport connection", async () => {
    vi.useFakeTimers();
    const child = new FakeChild(() => undefined);
    const connecting = AutomationWorkerClient.connect({
      endpointUrl: "http://127.0.0.1:9222",
      timeoutMs: 50,
      workerFactory: () => child.asChildProcess(),
    });
    const rejected = expect(connecting).rejects.toMatchObject({ code: "connection_timeout" });

    await vi.advanceTimersByTimeAsync(50);
    await rejected;
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores a successful initialization response that arrives after timeout", async () => {
    vi.useFakeTimers();
    let connectId = 0;
    const child = new FakeChild((message) => {
      if (message.method === "connect") connectId = message.id;
    });
    const connecting = AutomationWorkerClient.connect({
      endpointUrl: "http://127.0.0.1:9222",
      timeoutMs: 50,
      workerFactory: () => child.asChildProcess(),
    });
    const rejected = expect(connecting).rejects.toMatchObject({ code: "connection_timeout" });

    await vi.advanceTimersByTimeAsync(50);
    child.respond(success(connectId));
    await rejected;
    expect(child.kill).toHaveBeenCalledTimes(1);
  });

  it("terminates an attempt cancelled during initialization", async () => {
    const child = new FakeChild(() => undefined);
    const controller = new AbortController();
    const connecting = AutomationWorkerClient.connect({
      endpointUrl: "http://127.0.0.1:9222",
      timeoutMs: 1_000,
      abortSignal: controller.signal,
      workerFactory: () => child.asChildProcess(),
    });
    controller.abort(new Error("cancelled by test"));

    await expect(connecting).rejects.toMatchObject({ code: "cancelled" });
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("escalates cancellation when an active worker operation cannot acknowledge cleanup", async () => {
    vi.useFakeTimers();
    const child = new FakeChild((message) => {
      if (message.method === "connect") child.respond(success(message.id));
    });
    const client = await AutomationWorkerClient.connect({
      endpointUrl: "http://127.0.0.1:9222",
      timeoutMs: 1_000,
      workerFactory: () => child.asChildProcess(),
    });
    const controller = new AbortController();
    const operation = client.command(
      { method: "listTabs", params: {} },
      {
        abortSignal: controller.signal,
        cancelOperation: true,
        phase: "list-tabs",
      },
    );
    const rejected = expect(operation).rejects.toMatchObject({ code: "cancelled" });
    controller.abort(new Error("cancel active command"));

    await vi.advanceTimersByTimeAsync(5_000);
    await rejected;
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("settles a cancellation racing with success exactly once and ignores late messages", async () => {
    let connectId = 0;
    const child = new FakeChild((message) => {
      if (message.method === "connect") connectId = message.id;
    });
    const controller = new AbortController();
    const connecting = AutomationWorkerClient.connect({
      endpointUrl: "http://127.0.0.1:9222",
      timeoutMs: 1_000,
      abortSignal: controller.signal,
      workerFactory: () => child.asChildProcess(),
    });
    controller.abort(new Error("winner"));
    child.respond(success(connectId));

    await expect(connecting).rejects.toMatchObject({ code: "cancelled" });
    expect(child.kill).toHaveBeenCalledTimes(1);
  });

  it("contains worker failure during initialization and supports a clean retry", async () => {
    const failedChild = new FakeChild((message) => {
      failedChild.respond({
        kind: "response",
        id: message.id,
        ok: false,
        error: { name: "Error", message: "browser disconnected" },
      });
    });
    await expect(
      AutomationWorkerClient.connect({
        endpointUrl: "http://127.0.0.1:9222",
        timeoutMs: 1_000,
        workerFactory: () => failedChild.asChildProcess(),
      }),
    ).rejects.toMatchObject({ code: "transport_failure", retryable: true });

    const retryChild = new FakeChild((message) => retryChild.respond(success(message.id)));
    const retry = await AutomationWorkerClient.connect({
      endpointUrl: "http://127.0.0.1:9222",
      timeoutMs: 1_000,
      workerFactory: () => retryChild.asChildProcess(),
    });
    await retry.disconnect();
  });

  it("treats browser disconnection during initialization as a retryable transport failure", async () => {
    const child = new FakeChild(() => undefined);
    const connecting = AutomationWorkerClient.connect({
      endpointUrl: "http://127.0.0.1:9222",
      timeoutMs: 1_000,
      workerFactory: () => child.asChildProcess(),
    });
    child.crash();

    await expect(connecting).rejects.toMatchObject({
      code: "transport_failure",
      retryable: true,
      recovery: "reconnect",
    });
  });

  it("contains a synchronous IPC send failure", async () => {
    const child = new FakeChild(() => {
      throw new Error("ipc send failed");
    });

    await expect(
      AutomationWorkerClient.connect({
        endpointUrl: "http://127.0.0.1:9222",
        timeoutMs: 1_000,
        workerFactory: () => child.asChildProcess(),
      }),
    ).rejects.toMatchObject({ code: "transport_failure" });
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("normalizes a worker creation failure before transport creation", async () => {
    await expect(
      AutomationWorkerClient.connect({
        endpointUrl: "http://127.0.0.1:9222",
        timeoutMs: 1_000,
        workerFactory: () => {
          throw new Error("fork failed");
        },
      }),
    ).rejects.toMatchObject({
      code: "transport_failure",
      cause: expect.objectContaining({ message: "fork failed" }),
    });
  });

  it("fails closed when the isolated worker sends a malformed response", async () => {
    let connectId = 0;
    const child = new FakeChild((message) => {
      if (message.method === "connect") connectId = message.id;
    });
    const connecting = AutomationWorkerClient.connect({
      endpointUrl: "http://127.0.0.1:9222",
      timeoutMs: 1_000,
      workerFactory: () => child.asChildProcess(),
    });
    child.respond({ kind: "response", id: connectId, ok: "yes" });

    await expect(connecting).rejects.toMatchObject({
      code: "transport_failure",
      cause: {
        code: "transport_failure",
        cause: {
          name: "TypeError",
          responseSummary: {
            type: "object",
            ownPropertyNames: ["kind", "id", "ok"],
            kind: "response",
            id: 1,
            ok: "non-boolean",
            hasExpectedPrototype: true,
            hasRequiredFields: false,
          },
        },
      },
    });
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("rejects Node watch control messages without retaining dependency payloads", async () => {
    const child = new FakeChild(() => undefined);
    const connecting = AutomationWorkerClient.connect({
      endpointUrl: "http://127.0.0.1:9222",
      timeoutMs: 1_000,
      workerFactory: () => child.asChildProcess(),
    });
    child.respond({ "watch:import": ["file:///private/application.ts"] });

    let caught: unknown;
    try {
      await connecting;
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({
      code: "transport_failure",
      cause: {
        cause: {
          responseSummary: {
            ownPropertyNames: ["watch:import"],
            ownPropertyCount: 1,
            hasRequiredFields: false,
          },
        },
      },
    });
    expect(JSON.stringify(caught)).not.toContain("private");
    expect(child.listenerCount("message")).toBe(0);
    expect(child.listenerCount("error")).toBe(0);
    expect(child.listenerCount("exit")).toBe(0);
  });

  it("reconnects successfully after a recoverable malformed worker response", async () => {
    const failedChild = new FakeChild(() => undefined);
    const failedConnection = AutomationWorkerClient.connect({
      endpointUrl: "http://127.0.0.1:9222",
      timeoutMs: 1_000,
      workerFactory: () => failedChild.asChildProcess(),
    });
    failedChild.respond({ kind: "unexpected-worker-message" });
    await expect(failedConnection).rejects.toMatchObject({
      code: "transport_failure",
      retryable: true,
      recovery: "reconnect",
    });

    const healthyChild = new FakeChild((message) => healthyChild.respond(success(message.id)));
    const connection = await AutomationWorkerClient.connect({
      endpointUrl: "http://127.0.0.1:9222",
      timeoutMs: 1_000,
      workerFactory: () => healthyChild.asChildProcess(),
    });
    await connection.disconnect();

    expect(failedChild.listenerCount("message")).toBe(0);
    expect(healthyChild.listenerCount("message")).toBe(0);
  });

  it("isolates startup handshakes from Node watch IPC and cleans up repeated workers", async () => {
    const result = await runWatchedAutomationFixture();

    expect(result.stdout).toContain(
      JSON.stringify({ automationWorkerRegression: true, cleaned: true }),
    );
    expect(result.stderr).not.toContain("Invalid browser automation worker response");
    expect(result.exitCode === 0 || (result.exitCode === null && result.signal === "SIGINT")).toBe(
      true,
    );
  }, 15_000);

  it("turns an unexpected post-connect worker crash into a connection event", async () => {
    const child = new FakeChild((message) => child.respond(success(message.id)));
    const client = await AutomationWorkerClient.connect({
      endpointUrl: "http://127.0.0.1:9222",
      timeoutMs: 1_000,
      workerFactory: () => child.asChildProcess(),
    });
    const disconnected = vi.fn();
    client.onDisconnected(disconnected);

    child.crash();
    await Promise.resolve();
    expect(client.closed).toBe(true);
    expect(disconnected).toHaveBeenCalledOnce();
  });

  it("contains a late protocol assertion in a real child process", async () => {
    const client = await AutomationWorkerClient.connect({
      endpointUrl: "http://127.0.0.1:9222",
      timeoutMs: 1_000,
      workerFactory: () =>
        fork(new URL("./fixtures/crashing-automation-worker.mjs", import.meta.url), [], {
          stdio: ["ignore", "ignore", "ignore", "ipc"],
        }),
    });
    const disconnected = new Promise<void>((resolve) => client.onDisconnected(resolve));
    const operation = client.command(
      { method: "listTabs", params: {} },
      { phase: "regression-probe" },
    );

    await operation;
    await disconnected;
    expect(client.closed).toBe(true);
  });

  it("joins concurrent disconnect calls even when the backend is already marked closed", async () => {
    let finishDisconnect: (() => void) | undefined;
    const disconnect = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishDisconnect = resolve;
        }),
    );
    const backend: AutomationBackend = {
      closed: true,
      command: vi.fn(),
      disconnect,
      onDisconnected: () => () => undefined,
    };
    const connection = new PlaywrightBrowserConnectionImpl({
      backend,
      control: new BrowserControlState(),
    });

    const first = connection.disconnect();
    const second = connection.disconnect();
    expect(disconnect).toHaveBeenCalledOnce();
    finishDisconnect?.();
    await Promise.all([first, second]);
    await connection.disconnect();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("honors cancellation for a later caller waiting on an active disconnect", async () => {
    let finishDisconnect: (() => void) | undefined;
    const backend: AutomationBackend = {
      closed: false,
      command: vi.fn(),
      disconnect: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finishDisconnect = resolve;
          }),
      ),
      onDisconnected: () => () => undefined,
    };
    const connection = new PlaywrightBrowserConnectionImpl({
      backend,
      control: new BrowserControlState(),
    });
    const first = connection.disconnect({ timeoutMs: 1_000 });
    const controller = new AbortController();
    const second = connection.disconnect({
      timeoutMs: 1_000,
      abortSignal: controller.signal,
    });
    controller.abort(new Error("stop waiting"));

    await expect(second).rejects.toMatchObject({ code: "cancelled" });
    finishDisconnect?.();
    await first;
    expect(backend.disconnect).toHaveBeenCalledOnce();
  });

  it("does not close a connection when disconnect is already cancelled", async () => {
    const backend: AutomationBackend = {
      closed: false,
      command: vi.fn(),
      disconnect: vi.fn(async () => undefined),
      onDisconnected: () => () => undefined,
    };
    const connection = new PlaywrightBrowserConnectionImpl({
      backend,
      control: new BrowserControlState(),
    });
    const controller = new AbortController();
    controller.abort(new Error("keep connected"));

    await expect(connection.disconnect({ abortSignal: controller.signal })).rejects.toMatchObject({
      code: "cancelled",
    });
    expect(connection.closed).toBe(false);
    expect(backend.disconnect).not.toHaveBeenCalled();
    await connection.disconnect();
  });
});

function success(id: number): AutomationResponse {
  return { kind: "response", id, ok: true, value: undefined };
}

class FakeChild extends EventEmitter {
  connected = true;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  readonly kill = vi.fn((signal: NodeJS.Signals = "SIGTERM") => {
    if (this.exitCode !== null || this.signalCode !== null) return false;
    this.connected = false;
    this.signalCode = signal;
    queueMicrotask(() => this.emit("exit", null, signal));
    return true;
  });
  readonly send = vi.fn((message: AutomationRequest, callback?: (error: Error | null) => void) => {
    this.onSend(message);
    callback?.(null);
    return true;
  });

  constructor(private readonly onSend: (message: AutomationRequest) => void) {
    super();
  }

  respond(message: unknown): void {
    queueMicrotask(() => this.emit("message", message));
  }

  crash(): void {
    this.connected = false;
    this.exitCode = 1;
    this.emit("exit", 1, null);
  }

  asChildProcess(): ChildProcess {
    return this as unknown as ChildProcess;
  }
}

async function runWatchedAutomationFixture(): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}> {
  const fixture = fileURLToPath(
    new URL("./fixtures/watched-automation-client.ts", import.meta.url),
  );
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "--watch", "--watch-preserve-output", fixture],
    {
      cwd: process.cwd(),
      env: { ...process.env, NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stdout = "";
  let stderr = "";
  let completed = false;
  const marker = '"automationWorkerRegression":true';
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout = `${stdout}${chunk}`.slice(-32_768);
    if (!completed && stdout.includes(marker)) {
      completed = true;
      child.kill("SIGINT");
    }
  });
  child.stderr.on("data", (chunk: string) => {
    stderr = `${stderr}${chunk}`.slice(-32_768);
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Watched automation regression fixture timed out."));
    }, 10_000);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (exitCode, signal) => {
      clearTimeout(timer);
      if (!completed) {
        reject(
          new Error(
            `Watched automation regression fixture exited before completion: code=${exitCode ?? "null"} signal=${signal ?? "null"}\n${stderr}`,
          ),
        );
        return;
      }
      resolve({ stdout, stderr, exitCode, signal });
    });
  });
}
