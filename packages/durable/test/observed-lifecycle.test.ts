import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Agent, type AgentLifecycle } from "@anvia/core/agent";
import type { CompletionRequest } from "@anvia/core/completion";
import { DurableRuntime, type DurableAgentRegistration } from "../src/index.js";
import type { DurableRun } from "../src/run.js";
import { SqliteDurableStore } from "../src/sqlite.js";
import { capabilities, done } from "./helpers.js";
import { itSqlite } from "./helpers/backend.js";

const directories: string[] = [];
const runtimes: DurableRuntime[] = [];

function database(): string {
  const directory = mkdtempSync(join(tmpdir(), "durable-lifecycle-"));
  directories.push(directory);
  return join(directory, "runs.sqlite");
}

function agentWith(
  completion: (request: CompletionRequest) => Promise<ReturnType<typeof done>>,
  lifecycle: AgentLifecycle<string>,
) {
  return new Agent({
    id: "observed",
    model: {
      provider: "test",
      modelId: "test",
      capabilities,
      completion: (request) => completion(request),
    },
    lifecycle,
  });
}

async function open(path: string, agent: Agent, options: Partial<DurableAgentRegistration> = {}) {
  const runtime = await DurableRuntime.open({
    store: new SqliteDurableStore(path),
    agents: [{ agent, version: "1", lifecycle: { mode: "observe" }, ...options }],
  });
  runtimes.push(runtime);
  return runtime;
}

async function settled(run: DurableRun) {
  for (let attempt = 0; attempt < 250; attempt++) {
    const snapshot = await run.snapshot();
    if (["completed", "failed", "cancelled", "needs_attention"].includes(snapshot.run.status))
      return snapshot;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("The durable run did not settle.");
}

const submission = { agentId: "observed", sessionId: "session", requestId: "one" };

afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("observational lifecycle", () => {
  it("runs each hook once for the steps of a run", async () => {
    const hooks = {
      onStart: vi.fn(),
      onStepFinish: vi.fn(),
      onFinish: vi.fn(),
    };
    const agent = agentWith(async () => done(), hooks);
    const runtime = await open(database(), agent);
    const run = await runtime.submit({ ...submission, prompt: "hello" });
    await run.result();

    expect(hooks.onStart).toHaveBeenCalledTimes(1);
    expect(hooks.onStepFinish).toHaveBeenCalledTimes(1);
    expect(hooks.onStepFinish.mock.calls[0]![0]).toMatchObject({ step: 1 });
    expect(hooks.onFinish).toHaveBeenCalledTimes(1);
  });

  it("does not run a hook again after a failed attempt and a retry", async () => {
    const hooks = { onStart: vi.fn(), onStepFinish: vi.fn(), onError: vi.fn(), onFinish: vi.fn() };
    const failing = vi.fn(async (_request: CompletionRequest) => {
      throw new Error("provider down");
    });
    const path = database();
    const first = await open(path, agentWith(failing, hooks));
    const submitted = await first.submit({ ...submission, prompt: "hello" });
    expect((await settled(submitted)).run.status).toBe("failed");
    expect(hooks.onStart).toHaveBeenCalledTimes(1);
    expect(hooks.onError).toHaveBeenCalledTimes(1);
    await first.close();

    const model = vi.fn(async (_request: CompletionRequest) => done());
    const runtime = await open(path, agentWith(model, hooks));
    const run = await runtime.getRun(submitted.id);
    await run.retry();
    await run.result();

    // The start and the failure were recorded, so the retry does not repeat them.
    expect(hooks.onStart).toHaveBeenCalledTimes(1);
    expect(hooks.onError).toHaveBeenCalledTimes(1);
    expect(hooks.onStepFinish).toHaveBeenCalledTimes(1);
    expect(hooks.onFinish).toHaveBeenCalledTimes(1);
  });

  it("keeps the run outcome when a hook throws", async () => {
    const hook = vi.fn(() => {
      throw new Error("metrics sink down");
    });
    const runtime = await open(
      database(),
      agentWith(async () => done(), { onStepFinish: hook }),
    );
    const run = await runtime.submit({ ...submission, prompt: "hello" });

    await run.result();
    expect((await settled(run)).run.status).toBe("completed");
    expect(hook).toHaveBeenCalledTimes(1);
  });

  it("gives a hook a frozen snapshot, so it cannot change the request", async () => {
    const model = vi.fn(async (_request: CompletionRequest) => done());
    const agent = agentWith(model, {
      onStart(event) {
        // A strict-mode write to a frozen snapshot throws; the hook fails and the run continues.
        (event.input as { content: unknown }).content = "changed by a hook";
      },
    });
    const runtime = await open(database(), agent);
    const run = await runtime.submit({ ...submission, prompt: "original prompt" });
    await run.result();
    expect((await settled(run)).run.status).toBe("completed");

    const sent = JSON.stringify(model.mock.calls[0]![0]);
    expect(sent).toContain("original prompt");
    expect(sent).not.toContain("changed by a hook");
  });

  it("observes a second failure after an explicit retry at the same model turn", async () => {
    const hooks = { onStart: vi.fn(), onStepFinish: vi.fn(), onError: vi.fn(), onFinish: vi.fn() };
    const failing = vi.fn(async (_request: CompletionRequest) => {
      throw new Error("provider down");
    });
    const path = database();
    const first = await open(path, agentWith(failing, hooks));
    const submitted = await first.submit({ ...submission, prompt: "hello" });
    expect((await settled(submitted)).run.status).toBe("failed");
    expect(hooks.onError).toHaveBeenCalledTimes(1);

    // The retry fails again with no model turn in between, so only the retry count tells them apart.
    const run = await first.getRun(submitted.id);
    await run.retry();
    expect((await settled(submitted)).run.status).toBe("failed");
    expect(hooks.onError).toHaveBeenCalledTimes(2);
  });

  itSqlite("does not run a hook again when its start was recorded before a crash", async () => {
    const hooks = { onStart: vi.fn(), onStepFinish: vi.fn(), onError: vi.fn(), onFinish: vi.fn() };
    const failing = vi.fn(async (_request: CompletionRequest) => {
      throw new Error("provider down");
    });
    const path = database();
    const first = await open(path, agentWith(failing, hooks));
    const submitted = await first.submit({ ...submission, prompt: "hello" });
    expect((await settled(submitted)).run.status).toBe("failed");
    await first.close();

    // Simulate a crash inside onStart: its record is left at "started" with no completion.
    const db = new DatabaseSync(path);
    const rows = db
      .prepare("SELECT key, record FROM anvia_durable_operations WHERE run_id = ?")
      .all(submitted.id) as Array<{ key: string; record: string }>;
    const start = rows.find((row) => row.key.includes(":lifecycle:onStart:"))!;
    const record = JSON.parse(start.record) as { status: string; result?: unknown };
    db.prepare("UPDATE anvia_durable_operations SET record = ? WHERE run_id = ? AND key = ?").run(
      JSON.stringify({ ...record, status: "started", result: undefined }),
      submitted.id,
      start.key,
    );
    db.close();

    const runtime = await open(
      path,
      agentWith(async () => done(), hooks),
    );
    await (await runtime.getRun(submitted.id)).retry();
    expect((await settled(await runtime.getRun(submitted.id))).run.status).toBe("completed");
    expect(hooks.onStart).toHaveBeenCalledTimes(1);
  });

  it("rejects an unknown lifecycle mode at registration", async () => {
    const agent = agentWith(async () => done(), { onStart: () => undefined });
    await expect(
      DurableRuntime.open({
        store: new SqliteDurableStore(database()),
        agents: [{ agent, version: "1", lifecycle: { mode: "rewrite" } as never }],
      }),
    ).rejects.toThrow(/unknown lifecycle mode/);
  });
});
