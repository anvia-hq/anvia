import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, expectTypeOf, it } from "vitest";
import type { AgentOutcome } from "@anvia/core/agent";
import { DurableRuntime, DurableNotFoundError, type DurableRun } from "../src/index.js";
import { SqliteDurableStore } from "../src/sqlite.js";
import { done, makeAgent } from "./helpers.js";

const directories: string[] = [];
const runtimes: DurableRuntime[] = [];

afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

async function open(options: Partial<Parameters<typeof DurableRuntime.open>[0]> = {}) {
  const directory = mkdtempSync(join(tmpdir(), "durable-handle-"));
  directories.push(directory);
  const runtime = await DurableRuntime.open({
    store: new SqliteDurableStore(join(directory, "runs.sqlite")),
    ...options,
  });
  runtimes.push(runtime);
  return runtime;
}

describe("typed agent handle", () => {
  it("submits without an agentId and returns a run typed by the agent's output", async () => {
    const runtime = await open();
    const agent = makeAgent(async () => done());
    const researcher = runtime.agent({ agent, version: "1" });
    const run = await researcher.submit({ sessionId: "s", requestId: "r", prompt: "hi" });
    expectTypeOf(run).toEqualTypeOf<DurableRun<string>>();
    const outcome = await run.result();
    expectTypeOf(outcome).toEqualTypeOf<AgentOutcome<string>>();
    expect(outcome).toMatchObject({ type: "response", output: "done" });
    expect((await runtime.status(run.id)).agentId).toBe(agent.id);
  });

  it("handle() wraps an agent registered through open()", async () => {
    const agent = makeAgent(async () => done());
    const runtime = await open({ agents: [{ agent, version: "1" }] });
    const run = await runtime
      .handle(agent)
      .submit({ sessionId: "s", requestId: "r", prompt: "hi" });
    expect(await run.result()).toMatchObject({ output: "done" });
  });

  it("handle() rejects an agent that was never registered", async () => {
    const runtime = await open();
    expect(() => runtime.handle(makeAgent(async () => done()))).toThrow(DurableNotFoundError);
  });
});
