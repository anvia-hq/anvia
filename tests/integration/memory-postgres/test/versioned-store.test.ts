import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  MemoryAppendOptions,
  MemoryAppendResult,
  MemoryStore,
  MemoryScope,
  Message,
} from "@anvia/core";
import { DrizzleMemoryStore, drizzleMemorySchema } from "@anvia/memory-drizzle";
import { PostgresMemoryClient } from "@anvia/memory-postgres";

const baseUrl = process.env.ANVIA_POSTGRES_TEST_URL;
const user = (content: string): Message => ({ role: "user", content });
const scope = (): MemoryScope => ({ sessionId: randomUUID(), userId: randomUUID() });

type Versioned = Omit<MemoryStore, "append"> & {
  append(options: MemoryAppendOptions): Promise<MemoryAppendResult>;
  loadVersioned: NonNullable<MemoryStore["loadVersioned"]>;
  recordError: NonNullable<MemoryStore["recordError"]>;
};

const drizzleDdl = `
  CREATE TABLE agent_memory_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    scope_key text NOT NULL,
    session_id text NOT NULL,
    user_id text,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    compaction_state jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE UNIQUE INDEX agent_memory_sessions_scope_key_key ON agent_memory_sessions (scope_key);
  CREATE TABLE agent_memory_messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    memory_session_id uuid NOT NULL REFERENCES agent_memory_sessions(id) ON DELETE CASCADE,
    run_id text NOT NULL,
    turn integer NOT NULL,
    position integer NOT NULL,
    role text NOT NULL,
    message jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE UNIQUE INDEX agent_memory_messages_session_position_key
    ON agent_memory_messages (memory_session_id, position);
  CREATE TABLE agent_memory_errors (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    memory_session_id uuid NOT NULL REFERENCES agent_memory_sessions(id) ON DELETE CASCADE,
    run_id text NOT NULL,
    error jsonb NOT NULL,
    messages jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE agent_memory_writes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    scope_key text NOT NULL,
    idempotency_key text NOT NULL,
    fingerprint text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE UNIQUE INDEX agent_memory_writes_scope_key_idempotency_key_key
    ON agent_memory_writes (scope_key, idempotency_key);
`;

describe.skipIf(!baseUrl)("versioned memory against PostgreSQL", () => {
  const database = `anvia_memory_${randomUUID().replaceAll("-", "")}`;
  const connection = new URL(baseUrl ?? "postgresql://localhost/postgres");
  connection.pathname = `/${database}`;
  const url = connection.toString();
  const admin = new Client({ connectionString: baseUrl });
  const pool = new Pool({ connectionString: url, max: 12 });
  pool.on("error", () => {});
  const postgres = new PostgresMemoryClient({ client: pool });
  const stores: Record<string, Versioned> = {};
  let created = false;

  beforeAll(async () => {
    await admin.connect();
    // The name is generated locally from a UUID; the supplied database is never changed.
    await admin.query(`CREATE DATABASE "${database}"`);
    created = true;
    await pool.query(drizzleDdl);
    const db = drizzle(pool);
    const postgresStore = postgres.memoryStore();
    await postgresStore.ensure();
    stores["postgres advisory"] = postgresStore as unknown as Versioned;
    stores["drizzle advisory"] = new DrizzleMemoryStore({
      db,
      schema: drizzleMemorySchema,
    }) as unknown as Versioned;
    stores["drizzle without lock"] = new DrizzleMemoryStore({
      db,
      schema: drizzleMemorySchema,
      lock: "none",
    }) as unknown as Versioned;
  }, 30_000);

  afterAll(async () => {
    // Ending the pool first and dropping without FORCE keeps the server from killing a connection
    // that is still closing, which surfaces as an uncaught "terminating connection" error.
    await pool.end();
    if (created) await admin.query(`DROP DATABASE "${database}"`);
    await admin.end();
  });

  const names = ["postgres advisory", "drizzle advisory", "drizzle without lock"];

  describe.each(names)("%s", (name) => {
    const store = () => stores[name]!;

    it("commits once, reports duplicates and conflicts, and keeps keys across clear()", async () => {
      const context = scope();
      const empty = (await store().loadVersioned({ scope: context })).version;
      const write = {
        scope: context,
        runId: "run",
        turn: 1,
        messages: [user("one")],
        idempotencyKey: "k1",
      };

      const first = await store().append({ ...write, expectedVersion: empty });
      expect(first.status).toBe("committed");
      expect(await store().append({ ...write, expectedVersion: empty })).toEqual({
        status: "duplicate",
        version: first.version,
      });
      expect(
        await store().append({ ...write, messages: [user("other")], expectedVersion: empty }),
      ).toEqual({ status: "conflict", version: first.version });
      expect(
        (await store().append({ ...write, idempotencyKey: "k2", expectedVersion: empty })).status,
      ).toBe("conflict");

      await store().clear({ scope: context });
      expect((await store().loadVersioned({ scope: context })).version).toBe(empty);
      expect((await store().append(write)).status).toBe("duplicate");
      expect(await store().load({ scope: context })).toEqual([]);
    });

    it("keeps the empty version when recordError creates a session", async () => {
      const context = scope();
      const empty = (await store().loadVersioned({ scope: context })).version;
      await store().recordError({
        scope: context,
        runId: "failed",
        error: new Error("failed"),
        messages: [user("lost")],
      });
      expect((await store().loadVersioned({ scope: context })).version).toBe(empty);
      const result = await store().append({
        scope: context,
        runId: "run",
        turn: 1,
        messages: [user("one")],
        expectedVersion: empty,
      });
      expect(result.status).toBe("committed");
    });

    it("lets exactly one of several writers on one expectedVersion commit", async () => {
      const context = scope();
      const { version } = await store().loadVersioned({ scope: context });
      const results = await Promise.all(
        Array.from({ length: 8 }, (_, index) =>
          store().append({
            scope: context,
            runId: `run-${index}`,
            turn: 1,
            messages: [user(`writer ${index}`)],
            expectedVersion: version,
          }),
        ),
      );
      expect(results.filter((result) => result.status === "committed")).toHaveLength(1);
      expect(results.filter((result) => result.status === "conflict")).toHaveLength(7);
      expect(await store().load({ scope: context })).toHaveLength(1);
    });

    it("stores a keyed write once when it races itself", async () => {
      const context = scope();
      const write = {
        scope: context,
        runId: "run",
        turn: 1,
        messages: [user("once")],
        idempotencyKey: "same-key",
      };
      const results = await Promise.all(Array.from({ length: 6 }, () => store().append(write)));
      expect(results.filter((result) => result.status === "committed")).toHaveLength(1);
      expect(results.filter((result) => result.status === "duplicate")).toHaveLength(5);
      expect(await store().load({ scope: context })).toEqual([user("once")]);
    });
  });
});
