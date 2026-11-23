// @vitest-environment happy-dom
import { createDurableChatTransport, type DurableChatClient } from "@anvia/client/durable-chat";
import type { DurableEvent } from "@anvia/durable/protocol";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import * as publicReact from "../src";
import { useDurableChat } from "../src";

const runId = "run-1";
const at = "2026-01-01T00:00:00.000Z";

function event(sequence: number, type: DurableEvent["type"], data: DurableEvent["data"] = {}) {
  return { sequence, runId, createdAt: at, type, data } as DurableEvent;
}

type Gate = { promise: Promise<void>; open(): void };
function gate(): Gate {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => (open = resolve));
  return { promise, open };
}

function fakeClient(options: { events: DurableEvent[]; hold?: Gate; status?: string }) {
  const calls = { cancel: [] as string[], steer: [] as unknown[], retry: [] as string[] };
  const client = {
    async submit() {
      return { run: { id: runId, status: "queued" } };
    },
    async snapshot() {
      return { run: { id: runId, status: options.status ?? "running" }, operations: [], cursor: 0 };
    },
    async *stream(_id: string, streamOptions: { after?: number } = {}) {
      for (const value of options.events) {
        if (value.sequence <= (streamOptions.after ?? 0)) continue;

        if (value.sequence === 3) await options.hold?.promise;

        yield value;
      }
    },
    async respond() {},
    async resolveTool() {},
    async retry(id: string) {
      calls.retry.push(id);
    },
    async cancel(id: string) {
      calls.cancel.push(id);
    },
    async steer(id: string, input: unknown) {
      calls.steer.push({ id, input });
      return {};
    },
    async listRuns() {
      return { runs: [] };
    },
  };
  return { client: client as unknown as DurableChatClient, calls };
}

describe("useDurableChat", () => {
  it("is exported from the public entrypoint", () => {
    expect(publicReact).toHaveProperty("useDurableChat");
  });

  it("exposes the durable run id and status and controls the run", async () => {
    const hold = gate();
    const { client, calls } = fakeClient({
      hold,
      events: [
        event(1, "submitted"),
        event(2, "status", { status: "running" }),
        event(3, "status", { status: "completed" }),
      ],
    });
    const transport = createDurableChatTransport({ client, agentId: "a", sessionId: "s" });
    const { result } = renderHook(() => useDurableChat({ transport }));
    expect(result.current.run).toMatchObject({ id: undefined, status: undefined });

    let sent!: Promise<void>;
    act(() => {
      sent = result.current.sendMessage({ text: "hello" });
    });
    await waitFor(() => expect(result.current.run).toMatchObject({ id: runId, status: "running" }));

    await act(async () => {
      await result.current.run.steer({ prompt: "metric please" });
      await result.current.run.cancel();
      await result.current.run.retry();
    });
    expect(calls.steer).toEqual([{ id: runId, input: { prompt: "metric please" } }]);
    expect(calls.cancel).toEqual([runId]);
    expect(calls.retry).toEqual([runId]);

    hold.open();
    await act(async () => sent);
    await waitFor(() => expect(result.current.run.status).toBe("completed"));
    expect(result.current.status).toBe("ready");
  });

  it("reattaches to a run after a reload through resume storage", async () => {
    const storage = new Map<string, string>();
    const resume = {
      key: "durable-chat-test",
      storage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => void storage.set(key, value),
        removeItem: (key: string) => void storage.delete(key),
      } as Storage,
      auto: false,
    };
    const hold = gate();
    const events = [
      event(1, "submitted"),
      event(2, "status", { status: "running" }),
      event(3, "status", { status: "completed" }),
    ];
    const first = fakeClient({ events, hold });
    const transport = createDurableChatTransport({
      client: first.client,
      agentId: "a",
      sessionId: "s",
    });
    const before = renderHook(() => useDurableChat({ transport, resume }));
    act(() => void before.result.current.sendMessage({ text: "hello" }));
    await waitFor(() => expect(before.result.current.run.status).toBe("running"));
    before.unmount();

    // A new page: a fresh transport knows no run until the saved cursor reattaches it.
    const second = fakeClient({ events, status: "running" });
    const reloaded = createDurableChatTransport({
      client: second.client,
      agentId: "a",
      sessionId: "s",
    });
    const after = renderHook(() => useDurableChat({ transport: reloaded, resume }));
    expect(after.result.current.run.id).toBeUndefined();
    await act(async () => after.result.current.resume());
    await waitFor(() => expect(after.result.current.run.status).toBe("completed"));
    expect(after.result.current.run.id).toBe(runId);
    await act(async () => after.result.current.run.cancel());
    expect(second.calls.cancel).toEqual([runId]);
    hold.open();
  });
});
