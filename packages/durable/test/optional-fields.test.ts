import { expect, it } from "vitest";
import { registrations } from "../src/registration.js";
import { createRunRecord } from "../src/run-record.js";
import { parseDurableSteering } from "../src/steering.js";
import type { DurableAgentRegistration } from "../src/types.js";
import { done, makeAgent, makeStreamingAgent } from "./helpers.js";

const submission = {
  agentId: "researcher",
  sessionId: "session",
  requestId: "request",
  prompt: "hello",
};

it("omits unset registration and persisted run options", () => {
  const agent = makeAgent(async () => done());
  const registration = registrations([{ agent, version: "1" }]).get(agent.id)!;
  const record = createRunRecord(submission, registration);
  for (const key of ["stream", "compaction", "modelRetry"]) {
    expect(Object.hasOwn(registration, key)).toBe(false);
    expect(Object.hasOwn(record, key)).toBe(false);
  }
  expect(Object.hasOwn(record, "loopCompaction")).toBe(false);
  expect(registration.toolRecovery).toEqual({});
  expect(record.input).toEqual({ messages: [{ role: "user", content: "hello" }] });
});

it.each([false, true])("preserves an explicit stream option of %s", (stream) => {
  const agent = makeStreamingAgent(async function* () {
    yield { type: "final", response: done() };
  });
  const registration: DurableAgentRegistration = { agent, version: "1", stream };
  expect(registrations([registration]).get(agent.id)).toHaveProperty("stream", stream);
  expect(createRunRecord(submission, registration)).toHaveProperty("stream", stream);
});

it("copies persisted policies without mutating the registered options", () => {
  const agent = makeAgent(async () => done());
  const registration: DurableAgentRegistration = {
    agent,
    version: "1",
    compaction: {
      trigger: { afterTokens: 100 },
      retention: { recentToolTurns: 1 },
      compactor: async () => ({ summary: "summary", usage: done().usage }),
      tokenCounter: () => 0,
    },
    modelRetry: { maxAttempts: 2, initialDelayMs: 1, maxDelayMs: 2 },
  };
  const normalized = registrations([registration]).get(agent.id)!;
  expect(normalized.compaction?.compactor).toBe(registration.compaction!.compactor);
  expect(normalized.compaction?.tokenCounter).toBe(registration.compaction!.tokenCounter);

  const record = createRunRecord(submission, normalized);
  expect(record.loopCompaction).toBe(true);
  expect(record.compaction).toEqual({
    trigger: { afterTokens: 100 },
    retention: { recentToolTurns: 1 },
  });
  expect(record.compaction?.trigger).not.toBe(normalized.compaction!.trigger);
  expect(record.compaction?.retention).not.toBe(normalized.compaction!.retention);
  expect(record.modelRetry).toEqual(normalized.modelRetry);
  expect(record.modelRetry).not.toBe(normalized.modelRetry);
  record.compaction!.trigger.afterTokens = 200;
  record.compaction!.retention!.recentToolTurns = 2;
  record.modelRetry!.maxAttempts = 3;
  expect(normalized.compaction!.trigger.afterTokens).toBe(100);
  expect(normalized.compaction!.retention!.recentToolTurns).toBe(1);
  expect(normalized.modelRetry!.maxAttempts).toBe(2);
});

it("omits unset compaction retention and token counter", () => {
  const agent = makeAgent(async () => done());
  const registration = registrations([
    {
      agent,
      version: "1",
      compaction: {
        trigger: { afterTokens: 100 },
        compactor: async () => ({ summary: "summary", usage: done().usage }),
      },
    },
  ]).get(agent.id)!;
  expect(Object.hasOwn(registration.compaction!, "retention")).toBe(false);
  expect(Object.hasOwn(registration.compaction!, "tokenCounter")).toBe(false);
  expect(Object.hasOwn(createRunRecord(submission, registration).compaction!, "retention")).toBe(
    false,
  );
});

it("preserves steering request IDs and omits the property when absent", () => {
  const input = { prompt: "continue" };
  expect(parseDurableSteering({ input })).toStrictEqual({ input });
  expect(parseDurableSteering({ input, requestId: "request" })).toStrictEqual({
    input,
    requestId: "request",
  });
});
