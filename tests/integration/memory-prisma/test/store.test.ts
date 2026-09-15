import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import postgres from "@prisma/orm-postgres/runtime";
import type { MemoryCompactionMessage, Message, MemoryScope } from "@anvia/core";
import { PrismaMemoryStore as Store7 } from "@anvia/memory-prisma";
import { PrismaMemoryStore as Store8 } from "@anvia/memory-prisma/v8";
import { PrismaClient } from "../generated/v7/client/client.js";
import type { Contract } from "../generated/v8/contract.js";
import type { Contract as CustomContract } from "../generated/custom/contract.js";
import contractJson from "../generated/v8/contract.json" with { type: "json" };
import customJson from "../generated/custom/contract.json" with { type: "json" };

const baseUrl = process.env.ANVIA_PRISMA_TEST_URL;
const user = (content: string): Message => ({ role: "user", content });
const assistant = (content: string): Message => ({ role: "assistant", content });
const scope = (): MemoryScope => ({ sessionId: randomUUID(), userId: randomUUID() });
const summary = (content: string): MemoryCompactionMessage => ({
  role: "system",
  content,
  metadata: { anvia: { memoryCompaction: { version: 1, compactedMessageCount: 2 } } },
});

// Both schema owners must yield the same store behavior and PostgreSQL column types.
for (const schemaOwner of [7, 8]) {
  describe.skipIf(!baseUrl)(`Prisma ${schemaOwner} schema with both clients`, () => {
    const database = `anvia_memory_${randomUUID().replaceAll("-", "")}`;
    const connection = new URL(baseUrl ?? "postgresql://localhost/postgres");
    connection.pathname = `/${database}`;
    const url = connection.toString();
    const admin = new Client({ connectionString: baseUrl });
    const client7 = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const client8 = postgres<Contract>({ contractJson, url, verifyMarker: false });
    const store7 = new Store7({ client: client7 });
    const store8 = new Store8({ client: client8 });
    let created = false;

    beforeAll(async () => {
      await admin.connect();
      // The name is generated locally from a UUID; the supplied database is never changed.
      await admin.query(`CREATE DATABASE "${database}"`);
      created = true;
      const env = { ...process.env, ANVIA_PRISMA_TEST_URL: url };
      if (schemaOwner === 7) {
        execFileSync(
          "node",
          ["node_modules/prisma7/build/index.js", "db", "push", "--config", "prisma7.config.ts"],
          { env, stdio: "pipe" },
        );
      } else {
        execFileSync("pnpm", ["exec", "prisma", "db", "update", "--no-interactive"], {
          env,
          stdio: "pipe",
        });
      }
    }, 30_000);
    afterAll(async () => {
      await client7.$disconnect();
      await client8.close();
      if (created) await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);
      await admin.end();
    });

    it("validates without creating sessions and round-trips writes from either version", async () => {
      const before = await client7.agentMemorySession.count();
      await store7.validate();
      await store8.validate();
      expect(await client7.agentMemorySession.count()).toBe(before);
      const context = scope();
      await store7.append({ scope: context, runId: "v7", turn: 1, messages: [user("from seven")] });
      await store8.append({
        scope: context,
        runId: "v8",
        turn: 2,
        messages: [assistant("from eight")],
      });
      const expected = [user("from seven"), assistant("from eight")];
      expect(await store8.load({ scope: context })).toEqual(expected);
      expect(await store7.load({ scope: context })).toEqual(expected);
      const options = { limit: 5, userId: context.userId! };
      const conversations = await store8.inspector!.listConversations(options);
      expect(conversations).toEqual(await store7.inspector!.listConversations(options));
      const ref = conversations[0]!.ref;
      expect(await store8.inspector!.getConversation({ ref })).toEqual(
        await store7.inspector!.getConversation({ ref }),
      );
      expect(await store8.inspector!.getConversation({ ref: "absent" })).toBeUndefined();
    });

    it("isolates tenants and user filters, including an empty history", async () => {
      const store = new Store8({ client: client8, scopeKey: { metadataKeys: ["tenantId"] } });
      const context = scope();
      const tenantA = { ...context, metadata: { tenantId: "A" } };
      const tenantB = { ...context, metadata: { tenantId: "B" } };
      expect(await store.load({ scope: tenantA })).toEqual([]);
      await store.append({ scope: tenantA, runId: "a", turn: 1, messages: [user("A")] });
      await store.append({ scope: tenantB, runId: "b", turn: 1, messages: [user("B")] });
      expect(await store.load({ scope: tenantA })).toEqual([user("A")]);
      expect(await store.load({ scope: tenantB })).toEqual([user("B")]);
      expect(
        await store.inspector!.listConversations({ limit: 1, userId: context.userId! }),
      ).toHaveLength(1);
      expect(await store.inspector!.listConversations({ limit: 10, userId: "absent" })).toEqual([]);
      await store.clear({ scope: tenantA });
      expect(await store.load({ scope: tenantA })).toEqual([]);
      expect(await store.load({ scope: tenantB })).toEqual([user("B")]);
    });

    it("preserves UTC timestamps independently of the process timezone", async () => {
      const context = scope();
      await store8.append({
        scope: context,
        runId: "timestamp",
        turn: 1,
        messages: [user("hello")],
      });
      const row = await client7.agentMemorySession.findFirstOrThrow({
        where: { sessionId: context.sessionId },
      });
      const date = new Date("2023-02-01T03:04:05.678Z");
      await client7.agentMemorySession.update({
        where: { id: row.id },
        data: { createdAt: date, updatedAt: date },
      });
      expect(await store8.inspector!.getConversation({ ref: row.id })).toMatchObject({
        createdAt: date.toISOString(),
        updatedAt: date.toISOString(),
      });
    });

    it("stores errors and cascades deletion without leaking another scope", async () => {
      const context = scope();
      await store8.recordError({
        scope: context,
        runId: "failed",
        error: new Error("failed"),
        messages: [user("try")],
      });
      const row = await client7.agentMemorySession.findFirstOrThrow({
        where: { sessionId: context.sessionId },
      });
      expect(
        await client7.agentMemoryError.findMany({ where: { memorySessionId: row.id } }),
      ).toMatchObject([{ error: { message: "failed" }, messages: [user("try")] }]);
      await store8.append({ scope: context, runId: "retry", turn: 1, messages: [assistant("ok")] });
      await store8.clear({ scope: context });
      expect(await client7.agentMemoryMessage.count({ where: { memorySessionId: row.id } })).toBe(
        0,
      );
      expect(await client7.agentMemoryError.count({ where: { memorySessionId: row.id } })).toBe(0);
      const ignored = new Store8({
        client: client8,
        errorPolicy: "ignore",
        models: { errors: null },
      });
      await ignored.validate();
      await ignored.recordError({
        scope: context,
        runId: "ignored",
        error: "ignored",
        messages: [],
      });
      expect(
        await client7.agentMemorySession.count({ where: { sessionId: context.sessionId } }),
      ).toBe(0);
    });

    it("rolls back the session and all messages on a failed append", async () => {
      const context = scope();
      await expect(
        store8.append({
          scope: context,
          runId: "rollback",
          turn: 2 ** 40,
          messages: [user("overflow int4")],
        }),
      ).rejects.toThrow();
      expect(
        await client7.agentMemorySession.count({ where: { sessionId: context.sessionId } }),
      ).toBe(0);
      expect(await store8.load({ scope: context })).toEqual([]);
    });

    it("shares compaction checkpoints across versions and rejects stale revisions", async () => {
      const context = scope();
      const canonical = [user("old"), assistant("answer"), user("tail")];
      await store7.append({ scope: context, runId: "seed", turn: 1, messages: canonical });
      const snapshot = await store8.compaction!.snapshot({ scope: context });
      const replacement = summary("earlier messages");
      const request = {
        scope: context,
        revision: snapshot.revision,
        messageCount: 2,
        replacement,
        runId: "compact",
      };
      expect(await store8.compaction!.replacePrefix(request)).toEqual({ status: "committed" });
      expect(await store7.compaction!.snapshot({ scope: context })).toEqual(
        await store8.compaction!.snapshot({ scope: context }),
      );
      expect((await store8.compaction!.snapshot({ scope: context })).messages).toEqual([
        replacement,
        user("tail"),
      ]);
      expect(await store8.compaction!.replacePrefix(request)).toEqual({ status: "conflict" });
      const next = await store7.compaction!.snapshot({ scope: context });
      expect(
        await store7.compaction!.replacePrefix({
          ...request,
          revision: next.revision,
          replacement: summary("all messages"),
        }),
      ).toEqual({ status: "committed" });
      expect(await store8.compaction!.snapshot({ scope: context })).toEqual(
        await store7.compaction!.snapshot({ scope: context }),
      );
      expect(await store8.load({ scope: context })).toEqual(canonical);
      const beforeAppend = await store8.compaction!.snapshot({ scope: context });
      await store7.append({ scope: context, runId: "new", turn: 1, messages: [user("new")] });
      expect(
        await store8.compaction!.replacePrefix({
          ...request,
          revision: beforeAppend.revision,
          messageCount: 1,
        }),
      ).toEqual({ status: "conflict" });
    });

    it("sets the requested isolation level on the same transaction connection", async () => {
      type Tx = Parameters<Parameters<typeof client8.transaction>[0]>[0];
      const levels: string[] = [];
      const wrapped = {
        orm: client8.orm,
        raw: client8.raw,
        transaction: <T>(operation: (tx: Tx) => Promise<T>) =>
          client8.transaction(async (tx) =>
            operation({
              ...tx,
              execute: async (plan) => {
                const result = await tx.execute(plan);
                const rows = await tx.query(
                  client8.raw.sql`SHOW transaction_isolation`
                    .returnsRow({ transaction_isolation: "pg/text@1" })
                    .build(),
                );
                levels.push(rows[0]!.transaction_isolation);
                return result;
              },
            }),
          ),
      };
      for (const isolationLevel of ["ReadCommitted", "RepeatableRead", "Serializable"]) {
        await new Store8({ client: wrapped, transaction: { isolationLevel } }).append({
          scope: scope(),
          runId: "isolation",
          turn: 1,
          messages: [user("transaction")],
        });
      }
      expect(levels).toEqual(["read committed", "repeatable read", "serializable"]);
    });

    it("prevents two concurrent compactions from committing the same revision", async () => {
      const context = scope();
      await store8.append({
        scope: context,
        runId: "race",
        turn: 1,
        messages: [user("one"), assistant("two"), user("three")],
      });
      const snapshot = await store8.compaction!.snapshot({ scope: context });
      let arrived = 0;
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const timer = setTimeout(release, 3000);
      const racing = postgres<Contract>({
        contractJson,
        url,
        verifyMarker: false,
        middleware: [
          {
            name: "compaction-write-barrier",
            async beforeQuery(plan) {
              if (plan.sql.startsWith("INSERT INTO") && plan.sql.includes('"AgentMemorySession"')) {
                arrived += 1;
                if (arrived === 2) release();
                await gate;
              }
            },
          },
        ],
      });
      try {
        const store = new Store8({ client: racing });
        const request = {
          scope: context,
          revision: snapshot.revision,
          messageCount: 2,
          replacement: summary("racing"),
          runId: "compact",
        };
        const results = await Promise.allSettled([
          store.compaction!.replacePrefix(request),
          store.compaction!.replacePrefix(request),
        ]);
        expect(arrived).toBe(2);
        expect(
          results.filter(
            (result) => result.status === "fulfilled" && result.value.status === "committed",
          ),
        ).toHaveLength(1);
        const rejected = results.find((result) => result.status === "rejected");
        expect(rejected).toBeDefined();
        expect(rejected!.reason).toHaveProperty("sqlState", "40001");
        expect(await store8.load({ scope: context })).toEqual([
          user("one"),
          assistant("two"),
          user("three"),
        ]);
      } finally {
        clearTimeout(timer);
        release();
        await racing.close();
      }
    });

    it("supports custom model names in reads, writes, and transactions", async () => {
      const custom = postgres<CustomContract>({
        contractJson: customJson,
        url,
        verifyMarker: false,
      });
      try {
        const store = new Store8({
          client: custom,
          models: { sessions: "CustomSession", messages: "CustomMessage", errors: "CustomError" },
        });
        const context = scope();
        await store.validate();
        await store.append({
          scope: context,
          runId: "custom",
          turn: 1,
          messages: [user("custom model")],
        });
        expect(await store.load({ scope: context })).toEqual(await store7.load({ scope: context }));
        expect(
          await store.inspector!.listConversations({ userId: context.userId!, limit: 1 }),
        ).toHaveLength(1);
        const snapshot = await store.compaction!.snapshot({ scope: context });
        expect(
          await store.compaction!.replacePrefix({
            scope: context,
            revision: snapshot.revision,
            messageCount: 1,
            replacement: summary("custom"),
            runId: "compact",
          }),
        ).toEqual({ status: "committed" });
      } finally {
        await custom.close();
      }
    });
  });
}
