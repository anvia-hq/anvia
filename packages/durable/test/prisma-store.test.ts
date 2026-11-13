import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";
import { DurableRuntime } from "../src/index.js";
import { runCli } from "../src/prisma-cli.js";
import { PrismaDurableStore, prismaDurableModelNames, prismaDurableSchema } from "../src/prisma.js";
import { POSTGRES_DDL } from "../src/sql/ddl.js";
import { makeAgent, response } from "./helpers.js";
import { migrate, prismaOver } from "./helpers/adapters.js";
import { testPool } from "./helpers/postgres.js";

const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});

// These tests use a Prisma-shaped client over Postgres (PGlite or a server). No Prisma engine or
// generated client runs here: see the package docs for what that leaves unverified.
describe("PrismaDurableStore", () => {
  it("runs a durable agent through $queryRawUnsafe and interactive $transaction", async () => {
    const { pool } = testPool();
    await migrate(pool);
    const calls: string[] = [];
    const client = prismaOver(pool);
    const transaction = client.$transaction.bind(client);
    client.$transaction = (async (fn: never, options: unknown) => {
      calls.push(JSON.stringify(options));
      return transaction(fn, options as never);
    }) as typeof client.$transaction;
    const runtime = await DurableRuntime.open({
      store: new PrismaDurableStore(client),
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
    // Prisma's default interactive timeout is five seconds; the store raises it.
    expect(JSON.parse(calls[0]!)).toEqual({ maxWait: 10_000, timeout: 60_000 });
  });

  it("converts Prisma BigInt results and refuses a second live owner", async () => {
    const { pool } = testPool();
    await migrate(pool);
    const client = prismaOver(pool);
    const query = client.$queryRawUnsafe.bind(client);
    // Prisma returns int8 values as BigInt, whatever the driver does.
    client.$queryRawUnsafe = async (text, ...values) =>
      ((await query(text, ...values)) as Record<string, unknown>[]).map((row) =>
        Object.fromEntries(
          Object.entries(row).map(([key, value]) => [
            key,
            typeof value === "number" && Number.isInteger(value) ? BigInt(value) : value,
          ]),
        ),
      );
    const first = new PrismaDurableStore(client);
    await first.acquire();
    await expect(new PrismaDurableStore(client).acquire()).rejects.toThrow("live owner");
    expect(await first.transaction(async (tx) => tx.cursor())).toBe(0);
    await first.close();
  });

  it("fails clearly when the models have not been migrated", async () => {
    const { pool } = testPool();
    await expect(new PrismaDurableStore(prismaOver(pool)).acquire()).rejects.toThrow(
      /Durable schema is missing: anvia_durable_owner.*prisma/s,
    );
  });

  it("keeps the Prisma models in step with the SQL the store runs", async () => {
    const client = new PGlite();
    cleanup.push(() => client.close());
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
    const declared = new Map<string, Set<string>>();
    for (const [, body] of prismaDurableSchema.matchAll(/^model \w+ \{\n([\s\S]*?)^\}/gm)) {
      let table = "";
      const set = new Set<string>();
      for (const line of body!.split("\n")) {
        const map = line.match(/@@map\("(\w+)"\)/);
        if (map) table = map[1]!;
        const field = line.match(/^ {2}(\w+)\s+\S+/);
        if (field && !line.trim().startsWith("@@"))
          set.add(line.match(/@map\("(\w+)"\)/)?.[1] ?? field[1]!);
      }
      declared.set(table, set);
    }
    expect(declared.size).toBe(prismaDurableModelNames.length);
    expect(new Set(declared.keys())).toEqual(new Set(actual.keys()));
    for (const [table, set] of declared) expect(set, table).toEqual(actual.get(table));
  });
});

describe("anvia-durable-prisma init", () => {
  const sandbox = () => {
    const dir = mkdtempSync(join(tmpdir(), "anvia-durable-prisma-"));
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    mkdirSync(join(dir, "prisma"), { recursive: true });
    writeFileSync(
      join(dir, "prisma", "schema.prisma"),
      'datasource db { provider = "postgresql" }\n',
    );
    return dir;
  };
  const quiet = { log: () => {}, warn: () => {}, error: () => {} };

  it("writes the models next to the schema, or appends them between markers", async () => {
    const dir = sandbox();
    expect(await runCli(["init"], dir, quiet)).toBe(0);
    expect(() => readFileSync(join(dir, "prisma", "anvia-durable.prisma"))).toThrow();
    expect(await runCli(["init", "--write"], dir, quiet)).toBe(0);
    expect(readFileSync(join(dir, "prisma", "anvia-durable.prisma"), "utf8")).toContain(
      "model AnviaDurableRun {",
    );
    const other = sandbox();
    expect(await runCli(["init", "--write", "--append-to-schema"], other, quiet)).toBe(0);
    const schema = readFileSync(join(other, "prisma", "schema.prisma"), "utf8");
    expect(schema).toContain("BEGIN ANVIA DURABLE PRISMA MODELS");
    expect(await runCli(["init", "--write", "--append-to-schema"], other, quiet)).toBe(1);
    expect(await runCli(["init", "--write", "--append-to-schema", "--force"], other, quiet)).toBe(
      0,
    );
    expect(await runCli(["init", "--write"], other, quiet)).toBe(1);
  });
});
