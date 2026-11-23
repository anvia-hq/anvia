import { afterEach, describe, expect, it } from "vitest";
import { DurableClaimLostError, DurableRuntime } from "../src/index.js";
import { PostgresDurableStore } from "../src/postgres.js";
import { makeAgent } from "./helpers.js";
import { testPool } from "./helpers/postgres.js";

type Pool = ReturnType<typeof testPool>["pool"];

const stores: PostgresDurableStore[] = [];

afterEach(async () => {
  for (const store of stores.splice(0)) await store.close().catch(() => undefined);
});

function store(pool: Pool): PostgresDurableStore {
  const created = new PostgresDurableStore({ pool }, { schema: "create", leaseMs: 60_000 });
  stores.push(created);
  return created;
}

async function worker(pool: Pool): Promise<PostgresDurableStore> {
  const joined = store(pool);
  await joined.join();
  return joined;
}

const claimInput = (workerId: string, overrides: { limit?: number; leaseMs?: number } = {}) => ({
  workerId,
  now: new Date().toISOString(),
  limit: overrides.limit ?? 10,
  leaseMs: overrides.leaseMs ?? 60_000,
});

/**
 * Leaves unfinished runs in the store: a runtime whose model call never returns is closed, which
 * aborts the attempt and keeps the run unfinished, so another process could pick it up.
 */
async function seed(pool: Pool, runs: readonly { session: string; request: string }[]) {
  const runtime = await DurableRuntime.open({
    store: store(pool),
    agents: [
      {
        agent: makeAgent(
          (_request, signal) =>
            new Promise((_, reject) =>
              signal?.addEventListener("abort", () => reject(signal.reason)),
            ),
        ),
        version: "1",
      },
    ],
  });
  const ids: string[] = [];
  for (const { session, request } of runs) {
    const run = await runtime.submit(
      { agentId: "researcher", sessionId: session, requestId: request, prompt: "hi" },
      { enqueue: true },
    );
    ids.push(run.id);
  }
  await runtime.close();
  return ids;
}

async function settle(pool: Pool, runId: string) {
  const inspector = store(pool);
  await inspector.join();
  await inspector.transaction(async (tx) => {
    const run = (await tx.getRun(runId))!;
    run.status = "cancelled";
    run.error = "settled by test";
    await tx.putRun(run);
  });
}

describe("run claims", () => {
  it("keeps shared workers and an owning runtime from running together", async () => {
    const { pool } = testPool();
    const [run] = await seed(pool, [{ session: "s", request: "r" }]);
    const owner = store(pool);
    await owner.acquire();
    await expect(store(pool).join()).rejects.toThrow(/live owning runtime/);
    await owner.close();

    const joined = await worker(pool);
    const claims = await joined.claim!(claimInput("w1"));
    expect(claims.map((claim) => claim.runId)).toEqual([run]);
    await expect(store(pool).acquire()).rejects.toThrow(/live claims/);

    await joined.release!(claims);
    const again = store(pool);
    await again.acquire();
    await expect(joined.claim!(claimInput("w1"))).rejects.toThrow(/live owning runtime/);
  });

  it("never gives one run to two workers", async () => {
    const { pool } = testPool();
    await seed(
      pool,
      Array.from({ length: 6 }, (_, index) => ({ session: `s${index}`, request: "r" })),
    );
    const [a, b, c] = [await worker(pool), await worker(pool), await worker(pool)];
    const results = await Promise.all([
      a.claim!(claimInput("a")),
      b.claim!(claimInput("b")),
      c.claim!(claimInput("c")),
    ]);
    const ids = results.flat().map((claim) => claim.runId);
    expect(ids).toHaveLength(6);
    expect(new Set(ids).size).toBe(6);
  });

  it("claims only the oldest unfinished run of a session", async () => {
    const { pool } = testPool();
    const [first, second] = await seed(pool, [
      { session: "s", request: "1" },
      { session: "s", request: "2" },
    ]);
    const joined = await worker(pool);
    const claims = await joined.claim!(claimInput("w"));
    expect(claims.map((claim) => claim.runId)).toEqual([first]);
    expect(await joined.claim!(claimInput("w"))).toEqual([]);
    await settle(pool, first!);
    expect((await joined.claim!(claimInput("w"))).map((claim) => claim.runId)).toEqual([second]);
  });

  it("renews held claims and reports lost, settled, and unknown ones", async () => {
    const { pool } = testPool();
    const [a, b] = await seed(pool, [
      { session: "a", request: "r" },
      { session: "b", request: "r" },
    ]);
    const joined = await worker(pool);
    const claims = await joined.claim!(claimInput("w"));
    const refs = claims.map(({ runId, claimId }) => ({ runId, claimId }));
    expect(await joined.renew!({ workerId: "w", claims: refs, leaseMs: 60_000 })).toEqual({
      lost: [],
    });
    await settle(pool, a!);
    const unknown = { runId: "nope", claimId: "x" };
    const { lost } = await joined.renew!({
      workerId: "w",
      claims: [...refs, unknown],
      leaseMs: 60_000,
    });
    expect(new Set(lost)).toEqual(new Set([a, "nope"]));
    expect(
      (await joined.renew!({ workerId: "other", claims: refs, leaseMs: 60_000 })).lost,
    ).toHaveLength(2);
    expect(b).toBeDefined();
  });

  it("lets another worker take an expired claim and fences the stale one", async () => {
    const { pool } = testPool();
    const [run] = await seed(pool, [{ session: "s", request: "r" }]);
    const stale = await worker(pool);
    const fresh = await worker(pool);
    const [first] = await stale.claim!(claimInput("stale", { leaseMs: 40 }));
    expect(await fresh.claim!(claimInput("fresh"))).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 120));
    const [second] = await fresh.claim!(claimInput("fresh"));
    expect(second!.runId).toBe(run);
    expect(second!.claimId).not.toBe(first!.claimId);

    const lost = await stale.renew!({
      workerId: "stale",
      claims: [{ runId: run!, claimId: first!.claimId }],
      leaseMs: 60_000,
    });
    expect(lost.lost).toEqual([run]);
    await expect(
      stale.transaction(async (tx) => tx.assertClaim!(run!, first!.claimId)),
    ).rejects.toBeInstanceOf(DurableClaimLostError);
    await expect(
      fresh.transaction(async (tx) => tx.assertClaim!(run!, second!.claimId)),
    ).resolves.toBeUndefined();
  });

  it("releases a claim so another worker can take the run, and tolerates a lost release", async () => {
    const { pool } = testPool();
    const [run] = await seed(pool, [{ session: "s", request: "r" }]);
    const a = await worker(pool);
    const b = await worker(pool);
    const claims = await a.claim!(claimInput("a"));
    await a.release!(claims);
    await a.release!(claims);
    expect((await b.claim!(claimInput("b"))).map((claim) => claim.runId)).toEqual([run]);
    await a.release!(claims);
    expect(await a.claim!(claimInput("a"))).toEqual([]);
  });

  it("validates claim inputs and requires joining first", async () => {
    const { pool } = testPool();
    await seed(pool, [{ session: "s", request: "r" }]);
    const unjoined = store(pool);
    await expect(unjoined.claim!(claimInput("w"))).rejects.toThrow(/not joined/);
    const joined = await worker(pool);
    await expect(joined.claim!(claimInput("w", { limit: 0 }))).rejects.toThrow(TypeError);
    await expect(joined.claim!(claimInput("w", { leaseMs: 0 }))).rejects.toThrow(TypeError);
    await expect(joined.join!()).rejects.toThrow(/already open/);
  });
});
