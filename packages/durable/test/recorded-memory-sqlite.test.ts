import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { Agent } from "@anvia/core/agent";
import type { MemoryStore } from "@anvia/core/memory";
import { SqliteMemoryClient, type SqliteMemoryStore } from "@anvia/memory-sqlite";
import { DurableRuntime } from "../src/index.js";
import { SqliteDurableStore } from "../src/sqlite.js";
import { capabilities, done } from "./helpers.js";

const directories: string[] = [];
const runtimes: DurableRuntime[] = [];
const clients: SqliteMemoryClient[] = [];
const scope = { sessionId: "session" };

afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.close();
  for (const client of clients.splice(0)) await client.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

async function setup(completion: () => Promise<ReturnType<typeof done>> = async () => done()) {
  const directory = mkdtempSync(join(tmpdir(), "durable-memory-sqlite-"));
  directories.push(directory);
  const client = new SqliteMemoryClient({ path: join(directory, "memory.sqlite") });
  clients.push(client);
  const store: SqliteMemoryStore = client.memoryStore();
  await store.ensure();
  const agent = new Agent({
    id: "remembering",
    memory: { store, savePolicy: "run" },
    model: { provider: "test", modelId: "test", capabilities, completion },
  } as ConstructorParameters<typeof Agent>[0]);
  const runtime = await DurableRuntime.open({
    store: new SqliteDurableStore(join(directory, "runs.sqlite")),
    agents: [{ agent, version: "1", memory: { mode: "recorded" } }],
  });
  runtimes.push(runtime);
  return { store, runtime };
}

async function settled(run: Awaited<ReturnType<DurableRuntime["submit"]>>) {
  return vi.waitFor(
    async () => {
      const snapshot = await run.snapshot();
      expect(["completed", "failed", "needs_attention"]).toContain(snapshot.run.status);
      return snapshot;
    },
    { timeout: 5000 },
  );
}

const submit = (runtime: DurableRuntime, requestId: string, prompt: string) =>
  runtime.submit({ agentId: "remembering", sessionId: "session", requestId, prompt });

it("records memory against the SQLite adapter and carries the conversation into the next run", async () => {
  const { store, runtime } = await setup();

  expect((await settled(await submit(runtime, "one", "first"))).run.status).toBe("completed");
  expect((await settled(await submit(runtime, "two", "second"))).run.status).toBe("completed");

  const messages = await store.load({ scope });
  expect(messages.map((message) => message.role)).toEqual([
    "user",
    "assistant",
    "user",
    "assistant",
  ]);
});

it("needs attention when another writer commits to the SQLite adapter during the run", async () => {
  let store!: MemoryStore;
  const setupResult = await setup(async () => {
    await store.append({
      scope,
      runId: "other",
      turn: 1,
      messages: [{ role: "user", content: [{ type: "text", text: "concurrent" }] }],
    });
    return done();
  });
  store = setupResult.store;

  const snapshot = await settled(await submit(setupResult.runtime, "one", "hello"));

  expect(snapshot.run.status).toBe("needs_attention");
  expect(snapshot.run.blockedOperation).toBe("0:memory:write:0");
  expect(await store.load({ scope })).toHaveLength(1);
});

it("does not store a write twice when the SQLite adapter committed it and the response was lost", async () => {
  const { store, runtime } = await setup();
  const real = store.append.bind(store);
  let lost = true;
  store.append = async (options) => {
    const result = await real(options);
    if (lost) {
      lost = false;
      throw new Error("response lost");
    }
    return result;
  };

  const submitted = await submit(runtime, "one", "hello");
  expect((await settled(submitted)).run.status).toBe("failed");
  await submitted.retry();

  expect(
    (
      await vi.waitFor(
        async () => {
          const snapshot = await submitted.snapshot();
          expect(snapshot.run.status).toBe("completed");
          return snapshot;
        },
        { timeout: 5000 },
      )
    ).run.status,
  ).toBe("completed");
  expect(await store.load({ scope })).toHaveLength(2);
});
