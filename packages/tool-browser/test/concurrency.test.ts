import { describe, expect, it, vi } from "vitest";
import type { AutomationCommand } from "../src/automation-protocol";
import type { AutomationBackend, AutomationCommandOptions } from "../src/automation-client";
import { PlaywrightBrowserConnectionImpl } from "../src/connection";
import { BrowserControlState } from "../src/control";

const tabA = "11111111-1111-4111-8111-111111111111";
const tabB = "22222222-2222-4222-8222-222222222222";

describe("browser resource scheduling", () => {
  it("overlaps operations on different tabs in per-tab mode", async () => {
    const { connection, backend } = createConnection("per-tab");
    const first = action(connection, tabA);
    const firstCall = await backend.nextCall();
    const second = action(connection, tabB);
    const secondCall = await backend.nextCall();

    expect([firstCall.command, secondCall.command]).toEqual([
      expect.objectContaining({
        method: "pressKey",
        params: expect.objectContaining({ tabId: tabA }),
      }),
      expect.objectContaining({
        method: "pressKey",
        params: expect.objectContaining({ tabId: tabB }),
      }),
    ]);
    firstCall.resolve(result(tabA));
    secondCall.resolve(result(tabB));
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
  });

  it("keeps same-tab operations ordered and releases the queue after failure", async () => {
    const { connection, backend } = createConnection("per-tab");
    const first = action(connection, tabA);
    const firstCall = await backend.nextCall();
    const second = action(connection, tabA);
    await flushMicrotasks();
    expect(backend.calls).toHaveLength(1);

    firstCall.reject(new Error("injected failure"));
    await expect(first).rejects.toMatchObject({
      code: "tool_failed",
      cause: expect.objectContaining({ message: "injected failure" }),
    });
    const secondCall = await backend.nextCall();
    secondCall.resolve(result(tabA));
    await expect(second).resolves.toMatchObject({ tabId: tabA });
  });

  it("preserves global serial behavior in compatibility mode", async () => {
    const { connection, backend } = createConnection("serial");
    const first = action(connection, tabA);
    const firstCall = await backend.nextCall();
    const second = action(connection, tabB);
    await flushMicrotasks();
    expect(backend.calls).toHaveLength(1);

    firstCall.resolve(result(tabA));
    await first;
    const secondCall = await backend.nextCall();
    secondCall.resolve(result(tabB));
    await second;
  });

  it("bounds queued work without counting the active operation", async () => {
    const backend = new ManualBackend();
    const connection = new PlaywrightBrowserConnectionImpl({
      backend,
      control: new BrowserControlState(),
      scheduling: { mode: "per-tab", maxConcurrentTabs: 1, maxQueuedActions: 1 },
    });
    const active = action(connection, tabA);
    const activeCall = await backend.nextCall();
    const queued = action(connection, tabB);

    await expect(action(connection, "33333333-3333-4333-8333-333333333333")).rejects.toMatchObject({
      code: "agent_action_busy",
    });
    activeCall.resolve(result(tabA));
    await active;
    const queuedCall = await backend.nextCall();
    queuedCall.resolve(result(tabB));
    await queued;
  });

  it("cancels one tab without blocking another tab", async () => {
    const { connection, backend } = createConnection("per-tab");
    const controller = new AbortController();
    const cancelled = action(connection, tabA, controller.signal);
    await backend.nextCall();
    const independent = action(connection, tabB);
    const independentCall = await backend.nextCall();

    controller.abort(new Error("cancel tab A"));
    independentCall.resolve(result(tabB));
    await expect(cancelled).rejects.toMatchObject({ code: "cancelled" });
    await expect(independent).resolves.toMatchObject({ tabId: tabB });
  });

  it("marks a closing tab before queued work can target it", async () => {
    const { connection, backend } = createConnection("per-tab");
    const active = action(connection, tabA);
    const activeCall = await backend.nextCall();
    const closing = connection.closeTab(tabA, undefined, 1_000);

    await expect(action(connection, tabA)).rejects.toMatchObject({ code: "invalid_state" });
    activeCall.resolve(result(tabA));
    await active;
    const closeCall = await backend.nextCall();
    closeCall.resolve({ closedTabId: tabA, tabs: [] });
    await expect(closing).resolves.toMatchObject({ closedTabId: tabA });
  });

  it("serializes concurrent tab creation through the browser-context lock", async () => {
    const { connection, backend } = createConnection("per-tab");
    const first = connection.openTab(undefined, 1_000);
    const firstCall = await backend.nextCall();
    const second = connection.openTab(undefined, 1_000);
    await flushMicrotasks();
    expect(backend.calls).toHaveLength(1);

    firstCall.resolve(result(tabA));
    await first;
    const secondCall = await backend.nextCall();
    secondCall.resolve(result(tabB));
    await expect(second).resolves.toMatchObject({ tabId: tabB });
  });

  it("does not mark a tab closed when close times out before reaching the backend", async () => {
    vi.useFakeTimers();
    try {
      const { connection, backend } = createConnection("per-tab");
      const opening = connection.openTab(undefined, 1_000);
      const openCall = await backend.nextCall();
      const closing = connection.closeTab(tabA, undefined, 50);
      const rejected = expect(closing).rejects.toMatchObject({ code: "action_timeout" });

      await vi.advanceTimersByTimeAsync(50);
      await rejected;
      const stillUsable = action(connection, tabA);
      const actionCall = await backend.nextCall();
      actionCall.resolve(result(tabA));
      await expect(stillUsable).resolves.toMatchObject({ tabId: tabA });

      openCall.resolve(result(tabB));
      await opening;
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not poison tab tracking when a started close fails", async () => {
    const { connection, backend } = createConnection("per-tab");
    const closing = connection.closeTab(tabA, undefined, 1_000);
    const closeCall = await backend.nextCall();
    closeCall.reject(new Error("close refused"));
    await expect(closing).rejects.toMatchObject({ code: "tool_failed" });

    const retry = action(connection, tabA);
    const retryCall = await backend.nextCall();
    retryCall.resolve(result(tabA));
    await expect(retry).resolves.toMatchObject({ tabId: tabA });
  });

  it("rejects queued and active work predictably during shutdown", async () => {
    const { connection, backend } = createConnection("serial");
    const active = action(connection, tabA);
    await backend.nextCall();
    const queued = action(connection, tabB);

    await connection.disconnect();
    await expect(active).rejects.toMatchObject({ code: "connection_closed" });
    await expect(queued).rejects.toMatchObject({ code: "connection_closed" });
  });

  it("preserves connection_closed for active work contending on the context lock", async () => {
    const { connection, backend } = createConnection("per-tab");
    const opening = connection.openTab(undefined, 1_000);
    await backend.nextCall();
    const closing = connection.closeTab(tabA, undefined, 1_000);
    await flushMicrotasks();
    expect(backend.calls).toHaveLength(1);

    await connection.disconnect();
    await expect(opening).rejects.toMatchObject({ code: "connection_closed" });
    await expect(closing).rejects.toMatchObject({ code: "connection_closed" });
  });

  it("lets human control wait for active work and rejects new work while pending", async () => {
    const control = new BrowserControlState();
    const { connection, backend } = createConnection("per-tab", control);
    const active = action(connection, tabA);
    const activeCall = await backend.nextCall();
    const acquiring = control.acquireHumanControl({
      ownerId: "viewer",
      leaseTimeoutMs: 30_000,
      timeoutMs: 1_000,
    });

    expect(control.snapshot()).toMatchObject({ state: "human-pending", activeAgentActions: 1 });
    await expect(action(connection, tabB)).rejects.toMatchObject({
      code: "human_control_conflict",
    });
    activeCall.resolve(result(tabA));
    await active;
    const lease = await acquiring;
    expect(control.snapshot()).toMatchObject({ state: "human", ownerId: "viewer" });
    lease.release();
  });
});

function createConnection(mode: "serial" | "per-tab", control = new BrowserControlState()) {
  const backend = new ManualBackend();
  return {
    backend,
    connection: new PlaywrightBrowserConnectionImpl({
      backend,
      control,
      scheduling:
        mode === "serial" ? { mode: "serial" } : { mode: "per-tab", maxConcurrentTabs: 4 },
    }),
  };
}

function action(
  connection: PlaywrightBrowserConnectionImpl,
  tabId: string,
  abortSignal?: AbortSignal,
) {
  return connection.runTabCommand<ReturnType<typeof result>>({
    tabId,
    abortSignal,
    timeoutMs: 1_000,
    phase: "test-action",
    command: (targetTabId) => ({
      method: "pressKey",
      params: { tabId: targetTabId, key: "Enter" },
    }),
  });
}

function result(tabId: string) {
  return { tabId, title: "Tab", url: "https://example.com" };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

type ManualCall = {
  command: AutomationCommand;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
};

class ManualBackend implements AutomationBackend {
  readonly calls: ManualCall[] = [];
  private readonly callWaiters: Array<(call: ManualCall) => void> = [];
  private isClosed = false;
  private observedCalls = 0;

  get closed(): boolean {
    return this.isClosed;
  }

  command<T>(command: AutomationCommand, options: AutomationCommandOptions): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const call: ManualCall = { command, resolve: (value) => resolve(value as T), reject };
      this.calls.push(call);
      const waiter = this.callWaiters.shift();
      waiter?.(call);
      options.abortSignal?.addEventListener("abort", () => reject(options.abortSignal?.reason), {
        once: true,
      });
    });
  }

  nextCall(): Promise<ManualCall> {
    const observed = this.calls[this.observedCalls];
    if (observed !== undefined) {
      this.observedCalls += 1;
      return Promise.resolve(observed);
    }
    return new Promise((resolve) =>
      this.callWaiters.push((call) => {
        this.observedCalls += 1;
        resolve(call);
      }),
    );
  }

  async disconnect(): Promise<void> {
    this.isClosed = true;
  }

  onDisconnected(_listener: () => void): () => void {
    return () => undefined;
  }
}
