import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, expectTypeOf, it } from "vitest";
import {
  DurableRuntime,
  isDurableEvent,
  type DurableEvent,
  type DurableEventOf,
} from "../src/index.js";
import { SqliteDurableStore } from "../src/sqlite.js";
import { hasToolResult, lookup, makeAgent, toolResponse, done } from "./helpers.js";

const directories: string[] = [];
const runtimes: DurableRuntime[] = [];

afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

async function collect() {
  const directory = mkdtempSync(join(tmpdir(), "durable-events-"));
  directories.push(directory);
  const runtime = await DurableRuntime.open({
    store: new SqliteDurableStore(join(directory, "runs.sqlite")),
    agents: [
      {
        agent: makeAgent(
          async (request) => (hasToolResult(request) ? done() : toolResponse()),
          [lookup(async () => "ok")],
        ),
        version: "1",
      },
    ],
  });
  runtimes.push(runtime);
  const run = await runtime.submit({
    agentId: "researcher",
    sessionId: "s",
    requestId: "r",
    prompt: "hi",
  });
  await run.result();
  const events: DurableEvent[] = [];
  for await (const event of run.stream()) events.push(event);
  return events;
}

describe("typed durable events", () => {
  it("documents the payloads the runtime really writes", async () => {
    const events = await collect();
    const first = <T extends DurableEvent["type"]>(type: T) => {
      const event = events.find((candidate) => isDurableEvent(candidate, type));

      if (event === undefined || !isDurableEvent(event, type)) throw new Error(`no ${type} event`);

      return event;
    };

    expect(first("submitted").data).toMatchObject({
      agentId: "researcher",
      sessionId: "s",
      requestId: "r",
    });
    expect(first("status").data.status).toBeTypeOf("string");
    expect(first("model_started").data.operationId).toBeTypeOf("string");
    expect(first("model_completed").data.operationId).toBeTypeOf("string");
    expect(first("tool_started").data.operationId).toBeTypeOf("string");
    expect(first("tool_completed").data).toHaveProperty("result");
    const attempt = events.find((event) => event.type === "model_attempt_started");

    if (attempt !== undefined && isDurableEvent(attempt, "model_attempt_started"))
      expect(attempt.data.attempt).toBeTypeOf("number");
  });

  it("narrows by type, including several types at once", async () => {
    const events = await collect();
    const event = events[0]!;

    if (isDurableEvent(event, "tool_started", "tool_completed")) {
      expectTypeOf(event.data.operationId).toBeString();
    }

    expectTypeOf<DurableEventOf<"steering_applied">["data"]>().toEqualTypeOf<{
      id: string;
      epoch: number;
      turn: number;
    }>();
    expect(
      events.filter((candidate) => isDurableEvent(candidate, "status")).length,
    ).toBeGreaterThan(0);
    expect(isDurableEvent(events[0]!, "tool_started", "model_started")).toBe(false);
  });
});
