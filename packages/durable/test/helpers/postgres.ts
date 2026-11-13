import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import type { PostgresPoolLike } from "../../src/postgres.js";

/**
 * A Postgres database for tests. With `ANVIA_DURABLE_TEST_POSTGRES_URL` set, tests run against that
 * server (each store gets its own schema, so parallel files never collide); otherwise they run
 * against an in-process PGlite, which is real Postgres compiled to WASM.
 */
export const realPostgresUrl = process.env.ANVIA_DURABLE_TEST_POSTGRES_URL;

let counter = 0;
let lite: Promise<PGlite> | undefined;
let server: pg.Pool | undefined;

const unique = () => `t_${process.pid}_${Date.now().toString(36)}_${counter++}`;

/** A pool-like handle onto a fresh, empty schema. `key` names it, so a reopen finds the same data. */
export function testPool(): { pool: PostgresPoolLike; schema: string } {
  const schema = unique();
  return { pool: realPostgresUrl === undefined ? litePool(schema) : serverPool(schema), schema };
}

const schemas = new Map<string, PostgresPoolLike>();

/** The pool for a database "path": the same path always names the same data within one file. */
export function poolFor(path: string): PostgresPoolLike {
  if (path === ":memory:") return testPool().pool;
  let pool = schemas.get(path);
  if (pool === undefined) {
    pool = testPool().pool;
    schemas.set(path, pool);
  }
  return pool;
}

function serverPool(schema: string): PostgresPoolLike {
  server ??= new pg.Pool({ connectionString: realPostgresUrl, max: 8 });
  const shared = server;
  let ready: Promise<unknown> | undefined;
  const setup = () => (ready ??= shared.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`));
  return {
    async query(text, values) {
      await setup();
      const client = await shared.connect();
      try {
        await client.query(`SET search_path TO ${schema}`);
        return await client.query(text, values);
      } finally {
        client.release();
      }
    },
    async connect() {
      await setup();
      const client = await shared.connect();
      await client.query(`SET search_path TO ${schema}`);
      return client;
    },
  };
}

function litePool(schema: string): PostgresPoolLike {
  lite ??= PGlite.create();
  // One PGlite session serves every pool: a lock keeps one transaction at a time, and each
  // acquisition selects its own schema.
  let tail: Promise<unknown> = Promise.resolve();
  let ready: Promise<unknown> | undefined;
  const acquire = async (): Promise<{ db: PGlite; release: () => void }> => {
    let release!: () => void;
    const turn = new Promise<void>((resolve) => (release = resolve));
    const previous = tail;
    tail = turn;
    await previous;
    const db = await lite!;
    try {
      ready ??= db.exec(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
      await ready;
      await db.exec(`SET search_path TO ${schema}`);
    } catch (error) {
      release();
      throw error;
    }
    return { db, release };
  };
  return {
    async query(text, values) {
      const { db, release } = await acquire();
      try {
        return { rows: (await db.query<Record<string, unknown>>(text, values)).rows };
      } finally {
        release();
      }
    },
    async connect() {
      const { db, release } = await acquire();
      return {
        async query(text, values) {
          return { rows: (await db.query<Record<string, unknown>>(text, values)).rows };
        },
        release,
      };
    },
  };
}
