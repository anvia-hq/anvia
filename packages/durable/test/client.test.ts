import { afterEach, describe, expect, it, vi } from "vitest";
import type { CompletionRequest } from "@anvia/core/completion";
import { DurableClient, DurableRuntime, type DurableAgentRegistration } from "../src/index.js";
import { PostgresDurableStore } from "../src/postgres.js";
import { SqliteDurableStore } from "../src/sqlite.js";
import {
  Agent,
  capabilities,
  done,
  hasToolResult,
  lookup,
  makeAgent,
  toolResponse,
} from "./helpers.js";
import { testPool } from "./helpers/postgres.js";

type Pool = ReturnType<typeof testPool>["pool"];
type Completion = (
  request: CompletionRequest,
  signal?: AbortSignal,
) => Promise<ReturnType<typeof done>>;

const closers: Array<() => Promise<unknown>> = [];

afterEach(async () => {
  for (const close of closers.splice(0)) await close().catch(() => undefined);
});

const store = (pool: Pool) => new PostgresDurableStore({ pool }, { schema: "create" });

async function openWorker(
  pool: Pool,
  completion: Completion,
  extra: Partial<DurableAgentRegistration> & { tools?: Parameters<typeof makeAgent>[1] } = {},
) {
  const { tools, ...registration } = extra;
  const runtime = await DurableRuntime.open({
    store: store(pool),
    agents: [{ agent: makeAgent(completion, tools), version: "7", ...registration }],
    worker: { heartbeatMs: 20 },
    pollIntervalMs: 20,
  });
  closers.push(() => runtime.close());
  return runtime;
}

async function openClient(pool: Pool) {
  const client = await DurableClient.connect({ store: store(pool) });
  closers.push(() => client.close());
  return client;
}

const submission = (session: string, request = "r") => ({
  sessionId: session,
  requestId: request,
  prompt: "hi",
});

describe("DurableClient", () => {
  it("submits without an agent and a worker executes and admits the run", async () => {
    const { pool } = testPool();
    const client = await openClient(pool);
    const run = await client.agent<string>("researcher").submit(submission("s"));
    expect(await run.status()).toMatchObject({ status: "queued" });
    expect((await run.snapshot()).run).toMatchObject({ unadmitted: true, version: "unadmitted" });

    await openWorker(pool, async () => done());
    expect(await run.result()).toMatchObject({ output: "done" });
    const record = (await run.snapshot()).run;
    expect(record.version).toBe("7");
    expect(record.unadmitted).toBeUndefined();
    expect(record.maxModelTurns).toBeGreaterThan(1);
  });

  it("makes a submission idempotent and refuses a conflicting one", async () => {
    const { pool } = testPool();
    const client = await openClient(pool);
    const first = await client.submit({ agentId: "researcher", ...submission("s") });
    const again = await client.submit({ agentId: "researcher", ...submission("s") });
    expect(again.id).toBe(first.id);
    await expect(
      client.submit({ agentId: "researcher", ...submission("s"), prompt: "other" }),
    ).rejects.toThrow(/different submission/);
    await expect(
      client.submit({ agentId: "researcher", ...submission("s", "r2") }),
    ).rejects.toThrow(/unfinished work/);
    const queued = await client.submit(
      { agentId: "researcher", ...submission("s", "r2") },
      { enqueue: true },
    );
    expect(queued.id).not.toBe(first.id);
  });

  it("lets only one of many concurrent clients open a session", async () => {
    const { pool } = testPool();
    const clients = await Promise.all(Array.from({ length: 8 }, () => openClient(pool)));
    const results = await Promise.allSettled(
      clients.map((client, index) =>
        client.submit({ agentId: "researcher", ...submission("race", `r${index}`) }),
      ),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(
      (await clients[0]!.listRuns({ sessionId: "race" } as never)).runs.filter(
        (run) => run.sessionId === "race",
      ),
    ).toHaveLength(1);
  });

  it("leaves a run queued until a worker registers its agent", async () => {
    const { pool } = testPool();
    await openWorker(pool, async () => done()); // registers only "researcher"
    const client = await openClient(pool);
    const run = await client.agent("writer").submit(submission("s"));
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(await run.status()).toMatchObject({ status: "queued" });

    const writer = new Agent({
      id: "writer",
      model: {
        provider: "test",
        modelId: "test",
        capabilities,
        completion: async () => done(),
      },
    });
    const runtime = await DurableRuntime.open({
      store: store(pool),
      agents: [{ agent: writer, version: "1" }],
      worker: {},
      pollIntervalMs: 20,
    });
    closers.push(() => runtime.close());
    expect(await run.result()).toMatchObject({ output: "done" });
  });

  it("cancels a run a worker is executing and keeps the cancelled outcome", async () => {
    const { pool } = testPool();
    let aborted = false;
    let started = false;
    await openWorker(pool, async (_request, signal) => {
      started = true;
      await new Promise<void>((_resolve, reject) =>
        signal?.addEventListener("abort", () => {
          aborted = true;
          reject(signal.reason);
        }),
      );
      return done();
    });
    const client = await openClient(pool);
    const run = await client.agent("researcher").submit(submission("s"));
    await vi.waitFor(() => expect(started).toBe(true));
    await run.cancel();
    await vi.waitFor(() => expect(aborted).toBe(true));
    await expect(run.result()).rejects.toThrow(/cancelled/);
    expect(await run.status()).toMatchObject({ status: "cancelled" });
  });

  it("answers an approval request from the client and the worker resumes", async () => {
    const { pool } = testPool();
    await openWorker(pool, async (request) => (hasToolResult(request) ? done() : toolResponse()), {
      tools: [{ ...lookup(async () => "ok"), requiresApproval: true }],
    } as never);
    const client = await openClient(pool);
    const run = await client.agent("researcher").submit(submission("s"));
    await vi.waitFor(async () => expect((await run.status()).status).toBe("waiting"));
    const outcome = (await run.snapshot()).run.outcome;

    if (outcome?.type !== "interaction") throw new Error("Missing interaction");

    await run.respond(outcome.interaction.id, { type: "tool-approval", approved: true });
    expect(await run.result()).toMatchObject({ output: "done" });
  });

  it("retries a failed run from the client", async () => {
    const { pool } = testPool();
    let calls = 0;
    await openWorker(
      pool,
      async () => {
        calls++;

        if (calls === 1) throw new Error("model down");

        return done();
      },
      { modelRetry: { maxAttempts: 1, initialDelayMs: 1, maxDelayMs: 1 } },
    );
    const client = await openClient(pool);
    const run = await client.agent("researcher").submit(submission("s"));
    await vi.waitFor(async () =>
      expect(["failed", "needs_attention"]).toContain((await run.status()).status),
    );
    await run.retry();
    expect(await run.result()).toMatchObject({ output: "done" });
  });

  it("reads a run in a read-only transaction that takes no write locks", async () => {
    const { pool } = testPool();
    const client = await openClient(pool);
    const run = await client.agent("researcher").submit(submission("s"));
    // The client's own reads work in a store that rejects writes, so they cannot hold run locks.
    expect(await client.status(run.id)).toMatchObject({ status: "queued" });
    expect(await client.snapshot(run.id)).toMatchObject({ run: { id: run.id } });
    const shared = store(pool);
    await shared.join();
    closers.push(() => shared.close());
    await expect(
      shared.transaction(async (tx) => tx.putRun((await tx.getRun(run.id))!), { readOnly: true }),
    ).rejects.toThrow(/read-only/);
    await expect(
      shared.transaction(async (tx) => (await tx.getRun(run.id))?.id, { readOnly: true }),
    ).resolves.toBe(run.id);
  });

  it("refuses stores without shared access and a live owner", async () => {
    await expect(
      DurableClient.connect({ store: new SqliteDurableStore(":memory:") }),
    ).rejects.toThrow(/does not support clients/);
    const { pool } = testPool();
    const owner = await DurableRuntime.open({
      store: store(pool),
      agents: [{ agent: makeAgent(async () => done()), version: "1" }],
    });
    closers.push(() => owner.close());
    await expect(DurableClient.connect({ store: store(pool) })).rejects.toThrow(
      /live owning runtime/,
    );
  });
});
