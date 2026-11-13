import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { getTableConfig } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../src/drizzle-cli.js";
import { DrizzleDurableStore, anviaDurableTables } from "../src/drizzle.js";
import { DurableRuntime } from "../src/index.js";
import { POSTGRES_DDL } from "../src/sql/ddl.js";
import { makeAgent, response } from "./helpers.js";

const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});

async function database() {
  const client = new PGlite();
  cleanup.push(() => client.close());
  return { client, db: drizzle(client) };
}

describe("DrizzleDurableStore", () => {
  it("runs a durable agent through a real drizzle-orm PGlite database", async () => {
    const { db } = await database();
    for (const statement of POSTGRES_DDL) await db.execute(sql.raw(statement));
    const runtime = await DurableRuntime.open({
      store: new DrizzleDurableStore(db),
      agents: [
        { agent: makeAgent(async () => response([{ type: "text", text: "done" }])), version: "1" },
      ],
    });
    cleanup.push(() => runtime.close());
    const run = await runtime.submit({
      agentId: "researcher",
      sessionId: "s",
      requestId: "r",
      prompt: "hi",
    });
    expect(await run.result()).toMatchObject({ type: "response", output: "done" });
    expect((await runtime.metrics()).runs).toEqual({ completed: 1 });
    const rows = await db.execute(sql`SELECT status, agent_id FROM anvia_durable_runs`);
    expect(rows.rows).toEqual([{ status: "completed", agent_id: "researcher" }]);
  });

  it("refuses a second live owner and releases ownership on close", async () => {
    const { db } = await database();
    for (const statement of POSTGRES_DDL) await db.execute(sql.raw(statement));
    const first = new DrizzleDurableStore(db);
    await first.acquire();
    await expect(new DrizzleDurableStore(db).acquire()).rejects.toThrow("live owner");
    await first.close();
    const second = new DrizzleDurableStore(db);
    await second.acquire();
    await second.close();
  });

  it("fails clearly when the user-owned schema has not been migrated", async () => {
    const { db } = await database();
    await expect(new DrizzleDurableStore(db).acquire()).rejects.toThrow(
      /Durable schema is missing: anvia_durable_owner.*drizzle/s,
    );
  });

  it("keeps the table definitions in step with the SQL the store runs", async () => {
    const { client } = await database();
    for (const statement of POSTGRES_DDL) await client.exec(statement);
    const columns = await client.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns WHERE table_name LIKE 'anvia_durable_%'`,
    );
    const actual = new Map<string, Set<string>>();
    for (const row of columns.rows) {
      const set = actual.get(row.table_name) ?? new Set<string>();
      set.add(row.column_name);
      actual.set(row.table_name, set);
    }
    const declared = Object.values(anviaDurableTables).map((table) => getTableConfig(table));
    expect(new Set(declared.map((table) => table.name))).toEqual(new Set(actual.keys()));
    for (const table of declared)
      expect(new Set(table.columns.map((column) => column.name)), table.name).toEqual(
        actual.get(table.name),
      );
  });
});

describe("anvia-durable-drizzle init", () => {
  const sandbox = () => {
    const dir = mkdtempSync(join(tmpdir(), "anvia-durable-drizzle-"));
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    mkdirSync(join(dir, "src", "db"), { recursive: true });
    writeFileSync(join(dir, "src", "db", "schema.ts"), "export const users = {};\n");
    return dir;
  };
  const io = () => {
    const lines: string[] = [];
    return {
      lines,
      io: {
        log: (m: string) => lines.push(m),
        warn: (m: string) => lines.push(m),
        error: (m: string) => lines.push(m),
      },
    };
  };

  it("is a dry run by default and writes a re-export file with --write", async () => {
    const dir = sandbox();
    const dry = io();
    expect(await runCli(["init"], dir, dry.io)).toBe(0);
    expect(dry.lines.join("\n")).toContain("Would create src/db/anvia-durable.ts");
    const target = join(dir, "src", "db", "anvia-durable.ts");
    expect(() => readFileSync(target)).toThrow();
    const written = io();
    expect(await runCli(["init", "--write"], dir, written.io)).toBe(0);
    const content = readFileSync(target, "utf8");
    expect(content).toContain('from "@anvia/durable/drizzle"');
    for (const name of Object.keys(anviaDurableTables)) expect(content).toContain(name);
    expect(await runCli(["init", "--write"], dir, io().io)).toBe(1);
    expect(await runCli(["init", "--write", "--force"], dir, io().io)).toBe(0);
  });

  it("appends a replaceable block and refuses conflicting schemas", async () => {
    const dir = sandbox();
    expect(await runCli(["init", "--write", "--append-to-schema"], dir, io().io)).toBe(0);
    const schema = join(dir, "src", "db", "schema.ts");
    expect(readFileSync(schema, "utf8")).toContain("BEGIN ANVIA DURABLE DRIZZLE SCHEMA");
    expect(await runCli(["init", "--write", "--append-to-schema"], dir, io().io)).toBe(1);
    expect(await runCli(["init", "--write", "--append-to-schema", "--force"], dir, io().io)).toBe(
      0,
    );
    writeFileSync(schema, "export const anviaDurableRuns = 1;\n");
    const conflict = io();
    expect(await runCli(["init", "--write"], dir, conflict.io)).toBe(1);
    expect(conflict.lines.join("\n")).toContain("anviaDurableRuns");
  });
});
