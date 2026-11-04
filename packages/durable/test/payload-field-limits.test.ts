import { afterEach, expect, it } from "vitest";
import type { CompletionModelStreamEvent } from "@anvia/core/completion";
import { DurableRuntime, type DurableLimits } from "../src/index.js";
import { SqliteDurableStore } from "../src/sqlite.js";
import { done, makeAgent, makeStreamingAgent, response } from "./helpers.js";

const runtimes: DurableRuntime[] = [];
const submission = { agentId: "researcher", sessionId: "session", prompt: "hello" };
let requestSequence = 0;

afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.close();
});

async function open(
  maxPayloadBytes: DurableLimits["maxPayloadBytes"],
  agent = makeAgent(async () => done()),
) {
  const runtime = await DurableRuntime.open({
    store: new SqliteDurableStore(":memory:"),
    agents: [{ agent, version: "1" }],
    limits: { maxPayloadBytes },
  });
  runtimes.push(runtime);
  return runtime;
}

/** Submit one turn and wait for it to settle, whatever the outcome. */
async function settle(runtime: DurableRuntime, prompt = "hi") {
  const run = await runtime.submit({
    ...submission,
    requestId: `request-${(requestSequence += 1)}`,
    prompt,
  });
  for (let attempt = 0; attempt < 250; attempt++) {
    const snapshot = await run.snapshot();
    if (["completed", "failed", "cancelled", "needs_attention"].includes(snapshot.run.status))
      return snapshot.run;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("The durable run did not settle.");
}

/** The submit rejection for a prompt over the admission budget, so the run is never created. */
async function admissionError(runtime: DurableRuntime, prompt: string) {
  return runtime
    .submit({ ...submission, requestId: `request-${(requestSequence += 1)}`, prompt })
    .then(
      () => undefined,
      (error: unknown) => error,
    );
}

it("accepts a number as one budget for every field, as before", async () => {
  const runtime = await open(2_000);
  expect(runtime.limits().maxPayloadBytes).toBe(2_000);
  expect(await admissionError(runtime, "p".repeat(3_000))).toMatchObject({
    code: "payload_too_large",
    field: "run.prompt",
    limit: 2_000,
  });
});

it("fills every field group from the default when only the default is given", async () => {
  const runtime = await open({ default: 2_000 });
  expect(runtime.limits().maxPayloadBytes).toEqual({
    default: 2_000,
    prompt: 2_000,
    operation: 2_000,
    event: 2_000,
    outcome: 2_000,
  });
  expect(await admissionError(runtime, "p".repeat(3_000))).toMatchObject({
    field: "run.prompt",
    limit: 2_000,
  });
});

it("applies a prompt override to the submitted prompt and leaves operations on the default", async () => {
  // The prompt is admitted at 6,000 bytes, but the model request that carries it is 3,000+ bytes
  // and the operation budget is still 2,000, so the run fails on the operation, not the prompt.
  const runtime = await open({ default: 2_000, prompt: 6_000 });
  const run = await settle(runtime, "p".repeat(3_000));
  expect(run.status).toBe("failed");
  expect(run.error).toMatch(/operation\.input is \d+ bytes; limit is 2000 bytes/);
  expect(run.error).not.toMatch(/run\.prompt/);
});

it("admits a large prompt when the prompt and operation overrides both cover it", async () => {
  // The settled history keeps the prompt too, so the outcome budget covers the same text.
  const runtime = await open({ default: 2_000, prompt: 6_000, operation: 8_000, outcome: 8_000 });
  const run = await settle(runtime, "p".repeat(3_000));
  expect(run.status).toBe("completed");
  expect(run.outcome).toMatchObject({ type: "response", output: "done" });
});

it("applies an outcome override to the settled outcome only", async () => {
  // A 1,000-character answer has an outcome of about 3 KB: over the 2,000 default, under the
  // outcome override. Its model result is about 1 KB, which still fits the operation default.
  const answer = "a".repeat(1_000);
  const answering = () => response([{ type: "text", text: answer }]);

  const raised = await open(
    { default: 2_000, outcome: 8_000 },
    makeAgent(async () => answering()),
  );
  expect((await settle(raised)).status).toBe("completed");

  const plain = await open(
    2_000,
    makeAgent(async () => answering()),
  );
  const failed = await settle(plain);
  expect(failed.status).toBe("failed");
  expect(failed.error).toMatch(/run\.outcome is \d+ bytes; limit is 2000 bytes/);
});

it("does not let an outcome override raise the operation budget", async () => {
  // A 3,000-character answer fits the outcome override, but its model result exceeds the
  // operation default, so the failure names the operation and not the outcome.
  const answer = "a".repeat(3_000);
  const runtime = await open(
    { default: 2_000, outcome: 16_000 },
    makeAgent(async () => response([{ type: "text", text: answer }])),
  );
  const run = await settle(runtime);
  expect(run.status).toBe("failed");
  expect(run.error).toMatch(/operation\.result is \d+ bytes; limit is 2000 bytes/);
});

it("applies an event override to streamed deltas only", async () => {
  const delta = "s".repeat(3_000);
  const streamed = makeStreamingAgent(async function* () {
    yield { type: "text_delta", delta } satisfies CompletionModelStreamEvent;
    yield { type: "final", response: response([{ type: "text", text: delta }]) };
  });
  // The default event budget rejects the 3 KB delta, which is the only event-budget field.
  const plain = await DurableRuntime.open({
    store: new SqliteDurableStore(":memory:"),
    agents: [{ agent: streamed, version: "1", stream: true }],
    limits: { maxPayloadBytes: { default: 8_000, event: 2_000 } },
  });
  runtimes.push(plain);
  const rejected = await settle(plain);
  expect(rejected.status).toBe("failed");
  expect(rejected.error).toMatch(/event\.model_delta is \d+ bytes; limit is 2000 bytes/);

  const streamedAgain = makeStreamingAgent(async function* () {
    yield { type: "text_delta", delta } satisfies CompletionModelStreamEvent;
    yield { type: "final", response: response([{ type: "text", text: delta }]) };
  });
  const admitted = await DurableRuntime.open({
    store: new SqliteDurableStore(":memory:"),
    agents: [{ agent: streamedAgain, version: "1", stream: true }],
    // The final response repeats the streamed text three times in the outcome.
    limits: {
      maxPayloadBytes: { default: 2_000, event: 8_000, operation: 8_000, outcome: 16_000 },
    },
  });
  runtimes.push(admitted);
  expect((await settle(admitted)).status).toBe("completed");
});

it("rejects per-field values that are not positive integers, and unknown keys", async () => {
  const openWith = (maxPayloadBytes: unknown) =>
    DurableRuntime.open({
      store: new SqliteDurableStore(":memory:"),
      agents: [{ agent: makeAgent(async () => done()), version: "1" }],
      limits: { maxPayloadBytes: maxPayloadBytes as DurableLimits["maxPayloadBytes"] },
    });
  await expect(openWith(0)).rejects.toThrow("Invalid durable limit: maxPayloadBytes");
  await expect(openWith({ prompt: 0 })).rejects.toThrow(
    "Invalid durable limit: maxPayloadBytes.prompt",
  );
  await expect(openWith({ prompt: 1.5 })).rejects.toThrow(
    "Invalid durable limit: maxPayloadBytes.prompt",
  );
  await expect(openWith({ tool: 10 })).rejects.toThrow(
    "Invalid durable limit: maxPayloadBytes.tool",
  );
  await expect(openWith([1])).rejects.toThrow("Invalid durable limit: maxPayloadBytes");
});

it("returns a detached copy of per-field budgets", async () => {
  const runtime = await open({ default: 2_000, outcome: 8_000 });
  const limits = runtime.limits();
  expect(limits.maxPayloadBytes).toMatchObject({ outcome: 8_000 });
  if (typeof limits.maxPayloadBytes === "object") limits.maxPayloadBytes.outcome = 1;
  expect(runtime.limits().maxPayloadBytes).toMatchObject({ outcome: 8_000 });
});
