import { describe, expect, it, vi } from "vitest";
import { DurableClient } from "../src/durable";

const event = {
  sequence: 2,
  runId: "run",
  createdAt: "2026-10-06T00:00:00.000Z",
  type: "status",
  data: { status: "running" },
};
function stream(values: unknown[], onCancel?: () => void) {
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const value of values)
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`));
      },
      cancel() {
        onCancel?.();
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}

describe("durable browser client", () => {
  it("validates incoming event payloads, run identity, and increasing cursors", async () => {
    for (const values of [
      [{ ...event, runId: "different" }],
      [event, event],
      [{ ...event, sequence: "bad" }],
      [{ type: "error", error: "disconnected" }],
    ]) {
      const cancel = vi.fn();
      const client = new DurableClient({
        endpoint: "https://example.test/durable",
        fetch: async () => stream(values, cancel),
      });
      const iterator = client.stream("run", { after: 1 })[Symbol.asyncIterator]();
      if (values.length === 2) expect((await iterator.next()).value).toEqual(event);
      await expect(iterator.next()).rejects.toThrow();
      expect(cancel).toHaveBeenCalledTimes(1);
    }
  });

  it("cancels the response body when the consumer detaches", async () => {
    const cancel = vi.fn();
    const client = new DurableClient({
      endpoint: "https://example.test/durable",
      fetch: async () => stream([event], cancel),
    });
    for await (const received of client.stream("run")) {
      expect(received).toEqual(event);
      break;
    }
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("forwards fresh authorization, credentials, cursors and abort signals", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ runs: [] }));
    const headers = vi.fn(async () => ({ authorization: "Bearer example-token" }));
    const client = new DurableClient({
      endpoint: "https://example.test/durable/",
      headers,
      credentials: "include",
      fetch,
    });
    const controller = new AbortController();
    await client.listRuns(
      { sessionId: "my session", status: "waiting", after: 3, limit: 2 },
      { abortSignal: controller.signal },
    );
    expect(fetch).toHaveBeenCalledWith(
      "https://example.test/durable/runs?sessionId=my+session&status=waiting&after=3&limit=2",
      expect.objectContaining({ signal: controller.signal, credentials: "include" }),
    );
    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get("authorization")).toBe(
      "Bearer example-token",
    );
    controller.abort(new Error("detached"));
    await expect(client.snapshot("run", { abortSignal: controller.signal })).rejects.toThrow(
      "detached",
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(headers).toHaveBeenCalledTimes(1);
  });

  it("omits unset fetch options and steering request IDs", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (url) =>
      Response.json(
        String(url).endsWith("/steer") ? { id: "queued", status: "queued" } : { runs: [] },
      ),
    );
    const client = new DurableClient({ endpoint: "https://example.test/durable", fetch });
    await client.listRuns({ sessionId: "session" });
    const init = fetch.mock.calls[0]![1]!;
    for (const key of ["body", "signal", "credentials"]) {
      expect(Object.hasOwn(init, key)).toBe(false);
    }
    await client.steer("run", { prompt: "continue" });
    expect(fetch.mock.calls[1]![1]!.body).toBe('{"input":{"prompt":"continue"}}');
    await client.steer("run", { prompt: "continue" }, { requestId: "request" });
    expect(fetch.mock.calls[2]![1]!.body).toBe(
      '{"input":{"prompt":"continue"},"requestId":"request"}',
    );
  });

  it.each([undefined, false, true])(
    "preserves enqueue=%s in submission payloads",
    async (enqueue) => {
      const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 403 }));
      const client = new DurableClient({ endpoint: "https://example.test/durable", fetch });
      const submission = {
        agentId: "agent",
        sessionId: "session",
        requestId: "request",
        prompt: "hello",
      };
      const options: { enqueue?: boolean } = {};
      if (enqueue !== undefined) options.enqueue = enqueue;
      await expect(client.submit(submission, options)).rejects.toMatchObject({ status: 403 });
      const body = JSON.parse(String(fetch.mock.calls[0]![1]!.body));
      expect(Object.hasOwn(body, "enqueue")).toBe(enqueue !== undefined);
      if (enqueue !== undefined) expect(body.enqueue).toBe(enqueue);
      expect(submission).not.toHaveProperty("enqueue");
    },
  );
});

it("validates custom-task root identity and monotonic cursors and releases malformed streams", async () => {
  const task = {
    id: "task",
    rootId: "task",
    depth: 0,
    sessionId: "s",
    key: "1",
    name: "task",
    version: 1,
    submissionVersion: 1,
    submissionInput: null,
    input: null,
    checkpoint: null,
    status: "pending",
    signals: {},
    createdAt: event.createdAt,
    updatedAt: event.createdAt,
  };
  const taskEvent = {
    sequence: 2,
    rootId: "task",
    taskId: "task",
    createdAt: event.createdAt,
    type: "status",
    data: { status: "running" },
  };
  for (const values of [
    [{ ...taskEvent, rootId: "other" }],
    [taskEvent, taskEvent],
    [{ ...taskEvent, sequence: "bad" }],
    [{ type: "error" }],
  ]) {
    const cancel = vi.fn();
    const client = new DurableClient({
      endpoint: "https://test/durable",
      fetch: async (url) =>
        String(url).includes("/events")
          ? stream(values, cancel)
          : Response.json({ task, operations: [], cursor: 1 }),
    });
    const iterator = client.streamTask("task", { after: 1 })[Symbol.asyncIterator]();
    if (values.length === 2) expect((await iterator.next()).value).toEqual(taskEvent);
    await expect(iterator.next()).rejects.toThrow();
    expect(cancel).toHaveBeenCalledTimes(1);
  }
});

it("validates steering receipts from the server", async () => {
  for (const receipt of [{ id: "", status: "queued" }, { id: "id", status: "applied" }, null]) {
    const client = new DurableClient({
      endpoint: "https://example.test/durable",
      fetch: async () => Response.json(receipt),
    });
    await expect(client.steer("run", { prompt: "change" })).rejects.toThrow(
      "Invalid durable steering receipt",
    );
  }
});
