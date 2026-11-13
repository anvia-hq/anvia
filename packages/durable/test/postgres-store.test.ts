import { afterEach, describe, expect, it } from "vitest";
import { DurableRuntime } from "../src/index.js";
import { PostgresDurableStore, postgresSchemaSql } from "../src/postgres.js";
import { makeAgent, response } from "./helpers.js";
import { testPool } from "./helpers/postgres.js";

const stores: PostgresDurableStore[] = [];
const open = (pool: ReturnType<typeof testPool>["pool"], options = {}) => {
  const store = new PostgresDurableStore({ pool }, { schema: "create", ...options });
  stores.push(store);
  return store;
};

afterEach(async () => {
  for (const store of stores.splice(0)) await store.close().catch(() => undefined);
});

describe("PostgresDurableStore ownership and schema", () => {
  it("refuses a second live owner and accepts one after a clean close", async () => {
    const { pool } = testPool();
    const first = open(pool);
    await first.acquire();
    await expect(open(pool).acquire()).rejects.toThrow("live owner");
    await first.close();
    const second = open(pool);
    await second.acquire();
    await second.close();
  });

  it("lets a new owner take over an expired lease and fences the old owner", async () => {
    const { pool } = testPool();
    // Heartbeat far slower than the lease: the first owner's lease expires while it is "paused".
    const stale = open(pool, { leaseMs: 50, heartbeatMs: 60_000 });
    await stale.acquire();
    await new Promise((resolve) => setTimeout(resolve, 120));
    const fresh = open(pool, { leaseMs: 60_000 });
    await fresh.acquire();
    await expect(stale.transaction(async (tx) => tx.cursor())).rejects.toThrow(
      "ownership was lost",
    );
    await expect(fresh.transaction(async (tx) => tx.cursor())).resolves.toBe(0);
  });

  it("keeps the lease alive with its heartbeat", async () => {
    const { pool } = testPool();
    const owner = open(pool, { leaseMs: 200, heartbeatMs: 40 });
    await owner.acquire();
    await new Promise((resolve) => setTimeout(resolve, 500));
    await expect(open(pool).acquire()).rejects.toThrow("live owner");
  });

  it("verifies the schema by default and names what is missing", async () => {
    const { pool } = testPool();
    await expect(open(pool, { schema: "verify" }).acquire()).rejects.toThrow(
      /schema is missing: anvia_durable_owner/,
    );
    const migrated = testPool();
    await migrated.pool.query("SELECT 1");
    const client = await migrated.pool.connect();
    try {
      for (const statement of postgresSchemaSql.split(";\n\n")) {
        if (statement.trim() !== "") await client.query(statement);
      }
    } finally {
      client.release();
    }
    const store = open(migrated.pool, { schema: "verify" });
    await store.acquire();
  });

  it("rejects an unsupported schema version", async () => {
    const { pool } = testPool();
    const first = open(pool);
    await first.acquire();
    await first.close();
    await pool.query("UPDATE anvia_durable_owner SET version = 99");
    await expect(open(pool, { schema: "verify" }).acquire()).rejects.toThrow("schema version");
  });

  it("rolls a transaction back when its callback fails and serializes concurrent ones", async () => {
    const { pool } = testPool();
    const store = open(pool);
    await store.acquire();
    await expect(
      store.transaction(async (tx) => {
        await tx.appendEvent("run", "status", { n: 0 });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await store.events("run", 0, 10)).toEqual([]);
    await Promise.all(
      [1, 2, 3].map((n) =>
        store.transaction(async (tx) => {
          await tx.appendEvent("run", "status", { n });
          await Promise.resolve();
          await tx.appendEvent("run", "status", { n });
        }),
      ),
    );
    expect(
      (await store.events("run", 0, 10)).map((event) => (event.data as { n: number }).n),
    ).toEqual([1, 1, 2, 2, 3, 3]);
    await expect(
      store.transaction(async () => store.transaction(async () => undefined)),
    ).rejects.toThrow("Nested");
  });

  it("runs an agent end to end and exposes aggregate metrics", async () => {
    const { pool } = testPool();
    const runtime = await DurableRuntime.open({
      store: open(pool),
      agents: [
        { agent: makeAgent(async () => response([{ type: "text", text: "done" }])), version: "1" },
      ],
    });
    const run = await runtime.submit({
      agentId: "researcher",
      sessionId: "s",
      requestId: "r",
      prompt: "hi",
    });
    expect(await run.result()).toMatchObject({ type: "response" });
    const metrics = await runtime.metrics();
    expect(metrics.runs).toEqual({ completed: 1 });
    expect(metrics.databaseBytes).toBeGreaterThan(0);
    await runtime.close();
  });
});
