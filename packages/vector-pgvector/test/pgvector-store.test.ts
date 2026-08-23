import { describe, expect, it, vi } from "vitest";
import * as publicApi from "../src/index.js";
import { filterToPgVectorWhere, type PgClientLike, PgVectorClient } from "../src/index.js";

describe("PgVectorClient", () => {
  it("exports the client without legacy index or connect APIs", () => {
    expect(publicApi).toHaveProperty("PgVectorClient");
    expect(publicApi).not.toHaveProperty("PgVectorIndex");
    expect(publicApi.PgVectorStore).not.toHaveProperty("connect");
    expect(publicApi.PgVectorStore.prototype).not.toHaveProperty("index");
    expect(publicApi.PgVectorStore.prototype).not.toHaveProperty("asTool");
  });
  it("creates lazy handles, replaces rows, and performs raw searches", async () => {
    const query = vi.fn(async (input: string | { text: string }) => {
      const sql = typeof input === "string" ? input : input.text;
      return {
        rows: sql.startsWith("SELECT id")
          ? [
              {
                id: "point",
                document_id: "doc",
                document: { text: "cat" },
                metadata: null,
                distance: 0.1,
              },
            ]
          : sql.includes("information_schema")
            ? [{ data_type: "USER-DEFINED", udt_name: "vector" }]
            : [],
      };
    });
    const client: PgClientLike = { query };
    const store = new PgVectorClient({ client }).vectorStore<{ text: string }>({
      tableName: "docs",
      dimensions: 2,
    });
    expect(query).not.toHaveBeenCalled();
    await store.upsert({
      documents: [
        { id: "doc", document: { text: "cat" }, embeddings: [{ document: "cat", vector: [1, 0] }] },
      ],
    });
    expect(query.mock.calls.some(([sql]) => String(sql).startsWith("DELETE"))).toBe(true);
    await expect(store.search({ vector: [1, 0], topK: 1 })).resolves.toMatchObject([
      { id: "doc", score: 0.9 },
    ]);
  });

  it("uses JSON null semantics without binding an unused equality value", () => {
    expect(filterToPgVectorWhere({ type: "eq", key: "archivedAt", value: null }, 2)).toEqual({
      sql: "(metadata ? $2 AND metadata -> $2 = 'null'::jsonb)",
      values: ["archivedAt"],
    });
  });

  it("expands physical candidates until topK logical documents are available", async () => {
    const limits: number[] = [];
    const candidates = [
      { id: "a-1", document_id: "a", document: "A", metadata: null, distance: 0.1 },
      { id: "a-2", document_id: "a", document: "A", metadata: null, distance: 0.2 },
      { id: "b", document_id: "b", document: "B", metadata: null, distance: 0.3 },
      { id: "c", document_id: "c", document: "C", metadata: null, distance: 0.4 },
    ];
    const query = vi.fn(
      async (
        input: string | { text: string; values?: readonly unknown[] },
        positionalValues?: readonly unknown[],
      ) => {
        const text = typeof input === "string" ? input : input.text;
        const values = typeof input === "string" ? positionalValues : input.values;
        if (!text.startsWith("SELECT id")) return { rows: [] };
        const limit = Number(values?.at(-1));
        limits.push(limit);
        return { rows: candidates.slice(0, limit) };
      },
    );
    const client: PgClientLike = { query: query as PgClientLike["query"] };
    const store = new PgVectorClient({ client }).vectorStore<string>({
      tableName: "docs",
      dimensions: 2,
    });

    await expect(store.search({ vector: [1, 0], topK: 2 })).resolves.toMatchObject([
      { id: "a" },
      { id: "b" },
    ]);
    expect(limits).toEqual([2, 4]);
  });
});
