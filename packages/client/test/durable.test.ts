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
});
