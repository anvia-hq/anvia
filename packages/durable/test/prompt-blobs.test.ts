import { mkdtempSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { CompletionRequest } from "@anvia/core/completion";
import { z } from "zod";
import { DurableRuntime, defineTask } from "../src/index.js";
import type { DurableRun } from "../src/run.js";
import { SqliteDurableStore } from "../src/sqlite.js";
import { done, makeAgent } from "./helpers.js";
import { itSqlite } from "./helpers/backend.js";

const directories: string[] = [];
const runtimes: DurableRuntime[] = [];

function database(): string {
  const directory = mkdtempSync(join(tmpdir(), "durable-prompts-"));
  directories.push(directory);
  return join(directory, "runs.sqlite");
}

async function open(
  path: string,
  model: (request: CompletionRequest, signal?: AbortSignal) => Promise<unknown>,
) {
  const runtime = await DurableRuntime.open({
    store: new SqliteDurableStore(path),
    agents: [{ agent: makeAgent(model as never), version: "1" }],
  });
  runtimes.push(runtime);
  return runtime;
}

async function settled(run: DurableRun) {
  const result = await run.result();
  return result;
}

/** Raw stored text, exactly as it lies in the journal. */
function raw(path: string, sql: string): string[] {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return db
      .prepare(sql)
      .all()
      .map((row) => String(row.record ?? row.data));
  } finally {
    db.close();
  }
}

function blobCount(path: string): number {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return Number(db.prepare("SELECT COUNT(*) AS n FROM anvia_durable_blobs").get()!.n);
  } finally {
    db.close();
  }
}

afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

const threshold = 65_536;
const small = "short question ".repeat(10); // well under the threshold
const big = "prompt-".repeat(20_000); // 140 KB, over the threshold

itSqlite("keeps a prompt below the threshold inline", async () => {
  const path = database();
  const model = vi.fn(async (_request: CompletionRequest) => done());
  const runtime = await open(path, model);
  const run = await runtime.submit({
    agentId: "researcher",
    sessionId: "small",
    requestId: "one",
    prompt: small,
  });
  await settled(run);
  expect(blobCount(path)).toBe(0);
  const [record] = raw(path, "SELECT record FROM anvia_durable_runs");
  expect(record).toContain(small);
  const [submitted] = raw(path, "SELECT data FROM anvia_durable_events WHERE type = 'submitted'");
  expect(submitted).toContain(small);
});

itSqlite(
  "stores an oversized prompt as a blob reference and restores it for the model",
  async () => {
    const path = database();
    const model = vi.fn(async (_request: CompletionRequest) => done());
    const runtime = await open(path, model);
    const run = await runtime.submit({
      agentId: "researcher",
      sessionId: "big",
      requestId: "one",
      prompt: big,
    });
    await settled(run);
    expect(big.length).toBeGreaterThan(threshold);
    expect(blobCount(path)).toBeGreaterThan(0);
    for (const record of raw(path, "SELECT record FROM anvia_durable_runs"))
      expect(record.length).toBeLessThan(10_000);
    for (const data of raw(path, "SELECT data FROM anvia_durable_events WHERE type = 'submitted'"))
      expect(data.length).toBeLessThan(10_000);
    // The model still receives the whole prompt, and the snapshot shows it.
    expect(JSON.stringify(model.mock.calls[0]![0].chatHistory)).toContain(big);
    expect((await run.snapshot()).run.prompt).toBe(big);
  },
);

it("reads an oversized prompt back after a restart and treats a resubmit as a replay", async () => {
  const path = database();
  const first = await open(path, async () => done());
  const run = await first.submit({
    agentId: "researcher",
    sessionId: "replay",
    requestId: "one",
    prompt: big,
  });
  await settled(run);
  await first.close();
  runtimes.splice(runtimes.indexOf(first), 1);

  const restarted = await open(path, async () => done());
  const restored = await restarted.getRun(run.id);
  expect((await restored.snapshot()).run.prompt).toBe(big);
  // The same request with the same prompt returns the existing run; a different prompt conflicts.
  const again = await restarted.submit({
    agentId: "researcher",
    sessionId: "replay",
    requestId: "one",
    prompt: big,
  });
  expect(again.id).toBe(run.id);
  await expect(
    restarted.submit({
      agentId: "researcher",
      sessionId: "replay",
      requestId: "one",
      prompt: `${big}!`,
    }),
  ).rejects.toThrow("requestId already belongs to a different submission.");
});

itSqlite("externalizes an oversized message prompt and keeps its small parts inline", async () => {
  const path = database();
  const model = vi.fn(async (_request: CompletionRequest) => done());
  const runtime = await open(path, model);
  const prompt = {
    role: "user" as const,
    content: [
      { type: "text" as const, text: "describe this" },
      { type: "text" as const, text: big },
    ],
  };
  const run = await runtime.submit({
    agentId: "researcher",
    sessionId: "message",
    requestId: "one",
    prompt,
  });
  await settled(run);
  for (const record of raw(path, "SELECT record FROM anvia_durable_runs"))
    expect(record.length).toBeLessThan(10_000);
  expect((await run.snapshot()).run.prompt).toEqual(prompt);
  expect(JSON.stringify(model.mock.calls[0]![0].chatHistory)).toContain(big);
});

itSqlite(
  "moves oversized prompts of a schema version 11 store behind blob references",
  async () => {
    const path = database();
    const first = await open(path, async () => done());
    const run = await first.submit({
      agentId: "researcher",
      sessionId: "legacy",
      requestId: "one",
      prompt: small,
    });
    await settled(run);
    await first.close();
    runtimes.splice(runtimes.indexOf(first), 1);

    // Write the version 11 shape: the prompt inline in the run record and the submitted event.
    const db = new DatabaseSync(path);
    const record = JSON.parse(
      String(db.prepare("SELECT record FROM anvia_durable_runs").get()!.record),
    );
    record.prompt = big;
    record.input = { messages: [{ role: "user", content: big }] };
    db.prepare("UPDATE anvia_durable_runs SET record = ?").run(JSON.stringify(record));
    const event = JSON.parse(
      String(
        db.prepare("SELECT data FROM anvia_durable_events WHERE type = 'submitted'").get()!.data,
      ),
    );
    event.prompt = big;
    db.prepare("UPDATE anvia_durable_events SET data = ? WHERE type = 'submitted'").run(
      JSON.stringify(event),
    );
    db.prepare(
      "UPDATE anvia_durable_owner SET version = 11, token = NULL, pid = NULL, host = NULL",
    ).run();
    db.close();

    const migrated = await open(path, async () => done());
    expect((await (await migrated.getRun(run.id)).snapshot()).run.prompt).toBe(big);
    await migrated.close();
    runtimes.splice(runtimes.indexOf(migrated), 1);

    for (const data of raw(path, "SELECT data FROM anvia_durable_events WHERE type = 'submitted'"))
      expect(data.length).toBeLessThan(10_000);
    for (const stored of raw(path, "SELECT record FROM anvia_durable_runs"))
      expect(stored.length).toBeLessThan(10_000);
    const verify = new DatabaseSync(path, { readOnly: true });
    try {
      expect(
        verify.prepare("SELECT version FROM anvia_durable_owner WHERE singleton = 1").get()!
          .version,
      ).toBe(12);
    } finally {
      verify.close();
    }
  },
);

itSqlite(
  "keeps the submitted event of a task-spawned agent small and the model still receives the prompt",
  async () => {
    const path = database();
    const model = vi.fn(async (_request: CompletionRequest) => done());
    const parent = defineTask({
      name: "spawn-big-prompt",
      version: 1,
      input: z.null(),
      checkpoint: z.boolean(),
      output: z.string(),
      initial: () => false,
      run: async (ctx) => {
        if (!ctx.checkpoint)
          return {
            status: "waiting",
            checkpoint: true,
            wait: {
              type: "children",
              ids: [await ctx.spawnAgent("agent", { agentId: "researcher", prompt: big })],
              policy: "allSettled",
            },
          };
        return { status: "completed", output: (await ctx.children())[0]!.status };
      },
    });
    const runtime = await DurableRuntime.open({
      store: new SqliteDurableStore(path),
      tasks: [parent],
      agents: [{ agent: makeAgent(model as never), version: "1" }],
    });
    runtimes.push(runtime);
    const handle = await runtime.submitTask(parent, {
      sessionId: "task",
      requestId: "one",
      input: null,
    });
    expect(await handle.result()).toBe("completed");
    expect(blobCount(path)).toBeGreaterThan(0);
    for (const data of raw(path, "SELECT data FROM anvia_durable_events WHERE type = 'submitted'"))
      expect(data.length).toBeLessThan(10_000);
    expect(JSON.stringify(model.mock.calls[0]![0].chatHistory)).toContain(big);
  },
);

it("resumes a run that was in flight with an oversized prompt after a restart", async () => {
  const path = database();
  const started = vi.fn();
  const first = await open(path, async (_request, signal) => {
    started();
    // Hold the model call open until the runtime closes, as if the process went down mid-turn.
    await new Promise<void>((_resolve, reject) =>
      signal?.addEventListener("abort", () => reject(new Error("closed"))),
    );
    return done();
  });
  const run = await first.submit({
    agentId: "researcher",
    sessionId: "inflight",
    requestId: "one",
    prompt: big,
  });
  await vi.waitFor(() => expect(started).toHaveBeenCalled());
  await first.close();
  runtimes.splice(runtimes.indexOf(first), 1);

  const model = vi.fn(async (_request: CompletionRequest) => done());
  const restarted = await open(path, model);
  await restarted.resume();
  const restored = await restarted.getRun(run.id);
  expect((await restored.snapshot()).run.prompt).toBe(big);
  expect(await settled(restored)).toMatchObject({ output: "done" });
  expect(JSON.stringify(model.mock.calls.at(-1)?.[0].chatHistory ?? [])).toContain(big);
}, 30_000);
