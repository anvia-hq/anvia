import { afterEach, expect, it, vi } from "vitest";
import type { AgentCompletionStream } from "@anvia/core/internal/agent";
import { createExecution } from "../src/execution.js";
import { DurableModelError, DurableStorageError } from "../src/errors.js";
import { createRunRecord } from "../src/run-record.js";
import { SqliteDurableStore } from "../src/sqlite.js";
import { done, makeStreamingAgent } from "./helpers.js";

const stores: SqliteDurableStore[] = [];
afterEach(async () => {
  for (const store of stores.splice(0)) await store.close();
});

async function execution(signal = new AbortController().signal) {
  const store = new SqliteDurableStore(":memory:");
  await store.acquire();
  stores.push(store);
  const registration = {
    agent: makeStreamingAgent(async function* () {
      yield { type: "final", response: done() };
    }),
    version: "1",
  };
  const run = await createRunRecord(
    { agentId: "researcher", sessionId: "session", requestId: "request", prompt: "hello" },
    registration,
  );
  run.status = "running";
  await store.transaction(async (tx) => tx.putRun(run));
  return { store, run, boundary: createExecution(store, run, registration, signal) };
}

function iterator(cleanupError: Error) {
  const stream = (async function* (): AgentCompletionStream {
    yield { type: "text_delta", turn: 1, delta: "partial" };
    return done();
  })();
  const cleanup = vi.fn(async () => {
    throw cleanupError;
  });
  stream.return = cleanup;
  return { stream, cleanup };
}
const request = { chatHistory: [], tools: [], documents: [] };

it("preserves model failures when iterator cleanup also fails", async () => {
  const primary = new Error("provider failed");
  const { boundary } = await execution();
  const { stream, cleanup } = iterator(new Error("cleanup failed"));
  stream.next = vi.fn(async () => {
    throw primary;
  });
  const output = boundary.streamCompletion!(1, request, () => stream);
  await expect(output.next()).rejects.toMatchObject({ cause: primary });
  expect(cleanup).toHaveBeenCalledTimes(1);
});

it("preserves storage failures when iterator cleanup also fails", async () => {
  const primary = new DurableStorageError("delta persistence failed");
  const { boundary, store } = await execution();
  const transaction = store.transaction.bind(store);
  vi.spyOn(store, "transaction").mockImplementation(async (callback) =>
    transaction((tx) =>
      callback({
        ...tx,
        async appendEvent(id, type, data) {
          if (type === "model_delta") throw primary;
          await tx.appendEvent(id, type, data);
        },
      }),
    ),
  );
  const { stream, cleanup } = iterator(new Error("cleanup failed"));
  await expect(boundary.streamCompletion!(1, request, () => stream).next()).rejects.toBe(primary);
  expect(cleanup).toHaveBeenCalledTimes(1);
});

it("preserves cancellation when iterator cleanup also fails", async () => {
  const controller = new AbortController();
  const { boundary } = await execution(controller.signal);
  const { stream, cleanup } = iterator(new Error("cleanup failed"));
  const output = boundary.streamCompletion!(1, request, () => stream);
  await output.next();
  const cancellation = new Error("cancelled");
  controller.abort(cancellation);
  await expect(output.next()).rejects.toBe(cancellation);
  expect(cleanup).toHaveBeenCalledTimes(1);
});

it("surfaces cleanup failure when a subscriber closes without a primary failure", async () => {
  const cleanupError = new Error("cleanup failed");
  const { boundary } = await execution();
  const { stream } = iterator(cleanupError);
  const output = boundary.streamCompletion!(1, request, () => stream);
  await output.next();
  await expect(output.return(done())).rejects.toBe(cleanupError);
  expect(cleanupError).not.toBeInstanceOf(DurableModelError);
});
