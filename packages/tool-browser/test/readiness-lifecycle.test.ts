import { afterEach, describe, expect, it, vi } from "vitest";
import type { connectPlaywrightBrowser } from "../src/connection";
import { DockerBrowserHandle } from "../src/docker-browser";
import { BrowserError } from "../src/errors";

describe("DockerBrowser capability readiness", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("reports desktop readiness without attempting CDP automation", async () => {
    const sandbox = fakeSandbox();
    const connect = vi.fn(async () => {
      throw new Error("automation must not be probed");
    }) as unknown as typeof connectPlaywrightBrowser;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("desktop")),
    );
    const browser = new DockerBrowserHandle(sandbox as never, connect);

    const snapshot = await browser.waitForCapabilities({
      timeoutMs: 1_000,
      capabilities: ["desktop"],
    });
    expect(snapshot.capabilities.desktop.state).toBe("ready");
    expect(snapshot.capabilities.automation.state).toBe("unknown");
    expect(connect).not.toHaveBeenCalled();
  });

  it("rejects an unusable automation session and records the failed capability", async () => {
    vi.useFakeTimers();
    const sandbox = fakeSandbox();
    const disconnect = vi.fn(async () => undefined);
    const connect = vi.fn(async () => ({
      closed: true,
      disconnect,
    })) as unknown as typeof connectPlaywrightBrowser;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ webSocketDebuggerUrl: "ws://127.0.0.1/devtools" })),
    );
    const browser = new DockerBrowserHandle(sandbox as never, connect);
    const waiting = browser.waitForCapabilities({
      timeoutMs: 100,
      capabilities: ["automation"],
    });
    const rejected = expect(waiting).rejects.toMatchObject({
      code: "readiness_timeout",
      capability: "automation",
    });

    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    expect(browser.readiness().capabilities.automation).toMatchObject({
      state: "failed",
      error: { capability: "automation" },
    });
    expect(disconnect).toHaveBeenCalled();
  });

  it("keeps a healthy desktop usable when browser protocol discovery fails", async () => {
    vi.useFakeTimers();
    const sandbox = fakeSandbox();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) =>
        String(input).includes("6080")
          ? new Response("desktop")
          : Response.json({ Browser: "Chromium" }),
      ),
    );
    const browser = new DockerBrowserHandle(sandbox as never, vi.fn() as never);
    const waiting = browser.waitForCapabilities({
      timeoutMs: 100,
      capabilities: ["browser", "desktop"],
    });
    const rejected = expect(waiting).rejects.toMatchObject({ code: "readiness_timeout" });

    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    expect(browser.readiness()).toMatchObject({
      state: "degraded",
      capabilities: {
        browser: { state: "failed" },
        desktop: { state: "ready" },
      },
    });
  });

  it("preserves the final automation transport failure when readiness reaches its deadline", async () => {
    vi.useFakeTimers();
    const probeFailure = new BrowserError(
      "Browser automation worker sent an invalid response.",
      "transport_failure",
      { cause: new TypeError("Invalid browser automation worker response."), phase: "connect" },
    );
    const connect = vi.fn(async () => {
      throw probeFailure;
    }) as unknown as typeof connectPlaywrightBrowser;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ webSocketDebuggerUrl: "ws://127.0.0.1/devtools" })),
    );
    const browser = new DockerBrowserHandle(fakeSandbox() as never, connect);
    const waiting = browser.waitForCapabilities({
      timeoutMs: 100,
      capabilities: ["automation"],
    });
    const rejected = expect(waiting).rejects.toMatchObject({
      code: "transport_failure",
      capability: "automation",
      phase: "readiness",
      cause: probeFailure,
    });

    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    expect(connect).toHaveBeenCalledTimes(2);
    expect(browser.readiness().capabilities.automation).toMatchObject({
      state: "failed",
      error: { code: "transport_failure", cause: probeFailure },
    });
  });

  it("cancels readiness probes without retaining failed state", async () => {
    const sandbox = fakeSandbox();
    let observedSignal: AbortSignal | undefined;
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const connect = vi.fn(
      async (options: Parameters<typeof connectPlaywrightBrowser>[0]) =>
        new Promise<never>((_resolve, reject) => {
          observedSignal = options.abortSignal;
          markStarted?.();
          options.abortSignal?.addEventListener(
            "abort",
            () => reject(options.abortSignal?.reason),
            {
              once: true,
            },
          );
        }),
    ) as unknown as typeof connectPlaywrightBrowser;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ webSocketDebuggerUrl: "ws://127.0.0.1/devtools" })),
    );
    const browser = new DockerBrowserHandle(sandbox as never, connect);
    const controller = new AbortController();
    const waiting = browser.waitForCapabilities({
      timeoutMs: 1_000,
      capabilities: ["automation"],
      abortSignal: controller.signal,
    });
    await started;
    controller.abort(new Error("cancel probe"));

    await expect(waiting).rejects.toMatchObject({ code: "cancelled" });
    expect(observedSignal?.aborted).toBe(true);
    expect(browser.readiness().capabilities.automation.state).toBe("unknown");
  });

  it("does not start or mutate readiness for an already-cancelled caller", async () => {
    const connect = vi.fn() as unknown as typeof connectPlaywrightBrowser;
    const browser = new DockerBrowserHandle(fakeSandbox() as never, connect);
    const controller = new AbortController();
    controller.abort(new Error("do not probe"));

    await expect(
      browser.waitForCapabilities({
        timeoutMs: 1_000,
        capabilities: ["automation"],
        abortSignal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: "cancelled" });
    expect(connect).not.toHaveBeenCalled();
    expect(browser.readiness().capabilities.automation.state).toBe("unknown");
  });

  it("prevents an older cancelled probe from overwriting newer readiness", async () => {
    let rejectFirst: ((reason: unknown) => void) | undefined;
    let markFirstStarted: (() => void) | undefined;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    const connection = { closed: false, disconnect: vi.fn() };
    let connectCalls = 0;
    const connect = vi.fn(async (options: Parameters<typeof connectPlaywrightBrowser>[0]) => {
      connectCalls += 1;
      if (connectCalls === 1) {
        markFirstStarted?.();
        return new Promise<never>((_resolve, reject) => {
          rejectFirst = reject;
          options.abortSignal?.addEventListener(
            "abort",
            () => reject(options.abortSignal?.reason),
            { once: true },
          );
        });
      }
      return connection;
    }) as unknown as typeof connectPlaywrightBrowser;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ webSocketDebuggerUrl: "ws://127.0.0.1/devtools" })),
    );
    const browser = new DockerBrowserHandle(fakeSandbox() as never, connect);
    const oldController = new AbortController();
    const oldProbe = browser.waitForCapabilities({
      timeoutMs: 1_000,
      capabilities: ["automation"],
      abortSignal: oldController.signal,
    });
    await firstStarted;

    await browser.waitForCapabilities({ timeoutMs: 1_000, capabilities: ["automation"] });
    expect(browser.readiness().capabilities.automation.state).toBe("ready");

    oldController.abort(new Error("obsolete probe"));
    rejectFirst?.(oldController.signal.reason);
    await expect(oldProbe).rejects.toMatchObject({ code: "cancelled" });
    expect(browser.readiness().capabilities.automation.state).toBe("ready");
  });

  it("keeps control availability disconnected when stop aborts a readiness probe", async () => {
    const sandbox = fakeSandbox();
    const connect = abortableConnectionFactory();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ webSocketDebuggerUrl: "ws://127.0.0.1/devtools" })),
    );
    const browser = new DockerBrowserHandle(sandbox as never, connect.factory);
    const waiting = browser.waitForCapabilities({
      timeoutMs: 10_000,
      capabilities: ["automation"],
    });
    await connect.started;
    const rejected = expect(waiting).rejects.toMatchObject({ code: "connection_closed" });

    await browser.stop();
    await rejected;
    expect(browser.desktop.control.snapshot().availability).toBe("disconnected");
    expect(browser.readiness().state).toBe("stopped");
  });
});

describe("DockerBrowser pending connection ownership", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("retries deterministically after repeated connection failures", async () => {
    const sandbox = fakeSandbox();
    let attempts = 0;
    const connection = { closed: false, disconnect: vi.fn(async () => undefined) };
    const connect = vi.fn(async () => {
      attempts += 1;
      if (attempts <= 2) throw new Error(`injected failure ${attempts}`);
      return connection;
    }) as unknown as typeof connectPlaywrightBrowser;
    const browser = new DockerBrowserHandle(sandbox as never, connect);

    await expect(browser.connect()).rejects.toMatchObject({ code: "transport_failure" });
    await expect(browser.connect()).rejects.toMatchObject({ code: "transport_failure" });
    await expect(browser.connect()).resolves.toBe(connection);
    await browser.destroy();
  });

  it("releases ownership when endpoint resolution fails synchronously", async () => {
    const sandbox = fakeSandbox();
    sandbox.runtime.publishedPorts = sandbox.runtime.publishedPorts.filter(
      ({ containerPort }) => containerPort !== 9222,
    );
    const connect = vi.fn() as unknown as typeof connectPlaywrightBrowser;
    const browser = new DockerBrowserHandle(sandbox as never, connect);

    await expect(browser.connect()).rejects.toMatchObject({ code: "invalid_state" });

    expect(connect).not.toHaveBeenCalled();
    expect(
      (browser as unknown as { ownedOperations: ReadonlySet<unknown> }).ownedOperations.size,
    ).toBe(0);
    await browser.destroy();
  });

  it("rejects a second connection while one attempt owns the runtime", async () => {
    let finishConnect: ((connection: unknown) => void) | undefined;
    const connection = { closed: false, disconnect: vi.fn(async () => undefined) };
    const connect = vi.fn(
      () =>
        new Promise((resolve) => {
          finishConnect = resolve;
        }),
    ) as unknown as typeof connectPlaywrightBrowser;
    const browser = new DockerBrowserHandle(fakeSandbox() as never, connect);
    const first = browser.connect();

    await expect(browser.connect()).rejects.toMatchObject({ code: "agent_action_busy" });
    finishConnect?.(connection);
    await expect(first).resolves.toBe(connection);
    await expect(browser.connect()).rejects.toMatchObject({ code: "agent_action_busy" });
    await browser.destroy();
  });

  it("rejects a connection that disconnects at the initialization boundary", async () => {
    const sandbox = fakeSandbox();
    const disconnect = vi.fn(async () => undefined);
    const connect = vi.fn(async () => ({
      closed: true,
      disconnect,
    })) as unknown as typeof connectPlaywrightBrowser;
    const browser = new DockerBrowserHandle(sandbox as never, connect);

    await expect(browser.connect()).rejects.toMatchObject({ code: "connection_closed" });
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("aborts and joins a pending connection before stop completes", async () => {
    const sandbox = fakeSandbox();
    const connect = abortableConnectionFactory();
    const browser = new DockerBrowserHandle(sandbox as never, connect.factory);
    const connecting = browser.connect({ timeoutMs: 10_000 });
    await connect.started;

    await browser.stop();
    await expect(connecting).rejects.toMatchObject({ code: "connection_closed" });
    expect(connect.aborted()).toBe(true);
    expect(sandbox.stop).toHaveBeenCalledOnce();
  });

  it("aborts and joins a pending connection before destroy completes", async () => {
    const sandbox = fakeSandbox();
    const connect = abortableConnectionFactory();
    const browser = new DockerBrowserHandle(sandbox as never, connect.factory);
    const connecting = browser.connect({ timeoutMs: 10_000 });
    await connect.started;

    await browser.destroy();
    await expect(connecting).rejects.toMatchObject({ code: "runtime_destroyed" });
    expect(connect.aborted()).toBe(true);
    expect(sandbox.destroy).toHaveBeenCalledOnce();
  });

  it("does not enter stopping state for an already-cancelled stop", async () => {
    const sandbox = fakeSandbox();
    const browser = new DockerBrowserHandle(sandbox as never);
    const controller = new AbortController();
    controller.abort(new Error("do not stop"));

    await expect(browser.stop({ abortSignal: controller.signal })).rejects.toMatchObject({
      code: "cancelled",
    });
    expect(browser.readiness().state).toBe("unknown");
    expect(sandbox.stop).not.toHaveBeenCalled();
    await browser.destroy();
  });

  it("bounds a later caller waiting on an active stop", async () => {
    vi.useFakeTimers();
    let finishStop: (() => void) | undefined;
    const sandbox = fakeSandbox();
    sandbox.stop.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishStop = resolve;
        }),
    );
    const browser = new DockerBrowserHandle(sandbox as never);
    const first = browser.stop({ timeoutMs: 1_000 });
    await vi.advanceTimersByTimeAsync(1);
    const second = browser.stop({ timeoutMs: 50 });
    const rejected = expect(second).rejects.toMatchObject({ code: "lifecycle_timeout" });

    await vi.advanceTimersByTimeAsync(50);
    await rejected;
    expect(browser.readiness().state).toBe("stopped");
    finishStop?.();
    await first;
  });

  it("bounds destroy while retaining ownership of uncancellable sandbox cleanup", async () => {
    vi.useFakeTimers();
    let finishDestroy: (() => void) | undefined;
    const sandbox = fakeSandbox();
    sandbox.destroy.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishDestroy = resolve;
        }),
    );
    const browser = new DockerBrowserHandle(sandbox as never);
    const first = browser.destroy({ timeoutMs: 50 });
    const rejected = expect(first).rejects.toMatchObject({ code: "lifecycle_timeout" });

    await vi.advanceTimersByTimeAsync(50);
    await rejected;
    expect(browser.desktop.control.snapshot().availability).toBe("destroyed");
    expect(browser.state).toBe("destroying");

    const joined = browser.destroy({ timeoutMs: 1_000 });
    finishDestroy?.();
    await joined;
    expect(browser.state).toBe("destroyed");
    expect(sandbox.destroy).toHaveBeenCalledOnce();
  });

  it("bounds a cancelled destroy wait without abandoning sandbox cleanup", async () => {
    let finishDestroy: (() => void) | undefined;
    const sandbox = fakeSandbox();
    sandbox.destroy.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishDestroy = resolve;
        }),
    );
    const browser = new DockerBrowserHandle(sandbox as never);
    const controller = new AbortController();
    const first = browser.destroy({ timeoutMs: 10_000, abortSignal: controller.signal });

    controller.abort(new Error("stop waiting"));
    await expect(first).rejects.toMatchObject({ code: "cancelled" });
    expect(browser.state).toBe("destroying");

    const joined = browser.destroy({ timeoutMs: 1_000 });
    finishDestroy?.();
    await joined;
    expect(browser.state).toBe("destroyed");
    expect(sandbox.destroy).toHaveBeenCalledOnce();
  });

  it("keeps destroy terminal when an earlier stop completes late", async () => {
    let finishStop: (() => void) | undefined;
    let finishDestroy: (() => void) | undefined;
    let markStopStarted: (() => void) | undefined;
    let markDestroyStarted: (() => void) | undefined;
    const stopStarted = new Promise<void>((resolve) => {
      markStopStarted = resolve;
    });
    const destroyStarted = new Promise<void>((resolve) => {
      markDestroyStarted = resolve;
    });
    const sandbox = fakeSandbox();
    sandbox.stop.mockImplementation(() => {
      markStopStarted?.();
      return new Promise<void>((resolve) => {
        finishStop = resolve;
      });
    });
    sandbox.destroy.mockImplementation(() => {
      markDestroyStarted?.();
      return new Promise<void>((resolve) => {
        finishDestroy = resolve;
      });
    });
    const browser = new DockerBrowserHandle(sandbox as never);
    const stopping = browser.stop({ timeoutMs: 1_000 });
    await stopStarted;
    const destroying = browser.destroy({ timeoutMs: 1_000 });

    expect(browser.state).toBe("destroying");
    finishStop?.();
    await stopping;
    expect(browser.state).toBe("destroying");

    await destroyStarted;
    finishDestroy?.();
    await destroying;
    expect(browser.state).toBe("destroyed");
  });
});

function abortableConnectionFactory() {
  let markStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  let signal: AbortSignal | undefined;
  const factory = vi.fn(
    async (options: Parameters<typeof connectPlaywrightBrowser>[0]) =>
      new Promise<never>((_resolve, reject) => {
        signal = options.abortSignal;
        markStarted?.();
        options.abortSignal?.addEventListener("abort", () => reject(options.abortSignal?.reason), {
          once: true,
        });
      }),
  ) as unknown as typeof connectPlaywrightBrowser;
  return { factory, started, aborted: () => signal?.aborted === true };
}

function fakeSandbox() {
  let state = "running";
  return {
    id: "browser-test",
    get state() {
      return state;
    },
    runtime: {
      publishedPorts: [
        { containerPort: 9222, host: "127.0.0.1", hostPort: 49100, protocol: "tcp" },
        { containerPort: 6080, host: "127.0.0.1", hostPort: 49101, protocol: "tcp" },
      ],
      waitForPort: vi.fn(),
    },
    inspector: vi.fn(),
    stop: vi.fn(async () => {
      state = "stopped";
    }),
    destroy: vi.fn(async () => {
      state = "destroyed";
    }),
  };
}
