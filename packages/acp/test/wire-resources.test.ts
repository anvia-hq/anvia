import { getEventListeners } from "node:events";
import { ReadableStream, WritableStream } from "node:stream/web";
import { expect, it } from "vitest";
import { SessionManager } from "../src/session-manager.js";
import { createV1Agent } from "../src/wire/v1.js";
import { createV1Stream } from "../src/wire/stream.js";
import { deferred, makeAgent } from "./helpers.js";

it("releases SDK pending responses on repeated cancellation even when the client never replies", async () => {
  let cancelled = deferred();
  const options = {
    sessionFactory: () => makeAgent(),
    input: new ReadableStream<Uint8Array>(),
    output: new WritableStream<Uint8Array>({
      write(chunk) {
        if (JSON.parse(new TextDecoder().decode(chunk)).method === "$/cancel_request")
          cancelled.resolve();
      },
    }),
  };
  const sessions = new SessionManager(options);
  const connection = createV1Agent(sessions, options).connect(createV1Stream(options));
  // Regression against the pinned SDK's private registry; production uses no SDK internals.
  const state = connection as unknown as {
    connection: {
      pendingResponses: Map<unknown, unknown>;
      incomingRequests: Map<unknown, unknown>;
    };
  };
  try {
    for (let i = 0; i < 128; i++) {
      cancelled = deferred();
      const controller = new AbortController();
      const request = connection.client
        .request(
          "fs/read_text_file",
          {
            sessionId: "fixture",
            path: "/fixture/file",
          },
          { cancellationSignal: controller.signal },
        )
        .catch((error: unknown) => error);
      controller.abort();
      await cancelled.promise;
      await new Promise((resolve) => setImmediate(resolve));
      expect(state.connection.pendingResponses.size).toBe(0);
      expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
      expect(await request).toMatchObject({ code: -32800 });
    }
    const controller = new AbortController();
    const pending = connection.client
      .request(
        "fs/read_text_file",
        {
          sessionId: "fixture",
          path: "/fixture/file",
        },
        { cancellationSignal: controller.signal },
      )
      .catch((error: unknown) => error);
    expect(state.connection.pendingResponses.size).toBe(1);
    connection.close();
    await pending;
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  } finally {
    connection.close();
    await connection.closed;
    await sessions.close();
  }
  expect(state.connection.pendingResponses.size).toBe(0);
  expect(state.connection.incomingRequests.size).toBe(0);
});
