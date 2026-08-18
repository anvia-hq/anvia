import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import * as publicApi from "../src/index.js";
import {
  type LanceDBConnectionLike,
  type LanceDBTableLike,
  LanceDBVectorClient,
} from "../src/index.js";

// @ts-expect-error LanceDB no longer exposes an engine-specific SQL filter translator.
type RemovedFilterTranslator = typeof import("../src/index.js").filterToLanceExpr;

function fixture() {
  const toArray = vi.fn(async () => [
    {
      __anvia_document_id: "doc",
      __anvia_document: JSON.stringify({ text: "cat" }),
      __anvia_metadata: JSON.stringify({ source: "test", tenantId: "tenant-1" }),
      __anvia_vector: [1, 0],
      _distance: 0.1,
    },
  ]);
  const query = {
    limit: vi.fn(),
    where: vi.fn(),
    distanceType: vi.fn(),
    toArray,
  };
  query.limit.mockReturnValue(query);
  query.where.mockReturnValue(query);
  query.distanceType.mockReturnValue(query);
  const table: LanceDBTableLike = {
    add: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    countRows: vi.fn(async () => 1),
    search: vi.fn(() => query),
  };
  const client: LanceDBConnectionLike = {
    openTable: vi.fn(async () => table),
    tableNames: vi.fn(async () => ["docs"]),
    createTable: vi.fn(async () => table),
  };
  return { client, query, table };
}

describe("LanceDBVectorClient", () => {
  it("exports the client without legacy index or connect APIs", () => {
    expectTypeOf<RemovedFilterTranslator>().toBeAny();
    expect(publicApi).toHaveProperty("LanceDBVectorClient");
    expect(publicApi).not.toHaveProperty("filterToLanceExpr");
    expect(publicApi).not.toHaveProperty("LanceDBVectorIndex");
    expect(publicApi.LanceDBVectorStore).not.toHaveProperty("connect");
    expect(publicApi.LanceDBVectorStore.prototype).not.toHaveProperty("index");
    expect(publicApi.LanceDBVectorStore.prototype).not.toHaveProperty("asTool");
  });
  it("keeps construction lazy and uses explicit lifecycle", async () => {
    const { client } = fixture();
    const store = new LanceDBVectorClient({ client }).vectorStore({
      tableName: "docs",
      dimensions: 2,
    });
    expect(client.tableNames).not.toHaveBeenCalled();
    await store.ensure();
    expect(client.tableNames).toHaveBeenCalledOnce();
  });
  it("replaces and searches raw vectors", async () => {
    const { client, query, table } = fixture();
    const store = new LanceDBVectorClient({ client }).vectorStore<{ text: string }>({
      tableName: "docs",
      dimensions: 2,
    });
    await store.upsert({
      documents: [
        {
          id: "doc",
          document: { text: "cat" },
          metadata: { tenantId: "tenant-1" },
          embeddings: [{ document: "cat", vector: [1, 0] }],
        },
      ],
    });
    expect(table.delete).toHaveBeenCalled();
    expect(table.add).toHaveBeenCalled();
    expect(table.add).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          __anvia_metadata: JSON.stringify({ tenantId: "tenant-1" }),
        }),
      ],
      undefined,
    );
    expect((table.add as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]?.[0]).not.toHaveProperty(
      "tenantId",
    );
    await expect(
      store.search({
        vector: [1, 0],
        topK: 1,
        filter: { type: "eq", key: "tenantId", value: "tenant-1" },
      }),
    ).resolves.toMatchObject([
      { id: "doc", score: 0.9, metadata: { source: "test", tenantId: "tenant-1" } },
    ]);
    expect(query.distanceType).toHaveBeenCalledWith("cosine");
    expect(query.limit).toHaveBeenCalledWith(1);
    expect(query.where).not.toHaveBeenCalled();
  });

  it("provisions a stable metadata column", async () => {
    const { client, table } = fixture();
    client.tableNames = vi.fn(async () => []);
    client.createEmptyTable = vi.fn(async () => table);
    const store = new LanceDBVectorClient({ client }).vectorStore({
      tableName: "docs",
      dimensions: 2,
    });

    await store.ensure();

    const schema = (client.createEmptyTable as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as {
      fields: Array<{ name: string }>;
    };
    expect(schema.fields.map((field) => field.name)).toContain("__anvia_metadata");
  });

  it("expands physical candidates until topK logical documents are available", async () => {
    const limits: number[] = [];
    const candidates = [
      { __anvia_document_id: "a", __anvia_document: "A", _distance: 0.1 },
      { __anvia_document_id: "a", __anvia_document: "A", _distance: 0.2 },
      { __anvia_document_id: "b", __anvia_document: "B", _distance: 0.3 },
      { __anvia_document_id: "c", __anvia_document: "C", _distance: 0.4 },
    ];
    const table: LanceDBTableLike = {
      add: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
      countRows: vi.fn(async () => candidates.length),
      search: vi.fn(() => {
        let limit = 0;
        const query = {
          distanceType: vi.fn(() => query),
          limit: vi.fn((value: number) => {
            limit = value;
            limits.push(value);
            return query;
          }),
          where: vi.fn(() => query),
          toArray: vi.fn(async () => candidates.slice(0, limit)),
        };
        return query;
      }),
    };
    const client: LanceDBConnectionLike = {
      openTable: vi.fn(async () => table),
      tableNames: vi.fn(async () => ["docs"]),
      createTable: vi.fn(async () => table),
    };
    const store = new LanceDBVectorClient({ client }).vectorStore<string>({
      tableName: "docs",
      dimensions: 2,
    });

    await expect(store.search({ vector: [1, 0], topK: 2 })).resolves.toMatchObject([
      { id: "a" },
      { id: "b" },
    ]);
    expect(limits).toEqual([2, 4]);
  });

  it("expands physical candidates when metadata filtering removes nearer results", async () => {
    const limits: number[] = [];
    const candidates = [
      {
        __anvia_document_id: "a",
        __anvia_document: "A",
        __anvia_metadata: JSON.stringify({ tenantId: "other" }),
        _distance: 0.1,
      },
      {
        __anvia_document_id: "b",
        __anvia_document: "B",
        __anvia_metadata: JSON.stringify({ tenantId: "tenant-1" }),
        _distance: 0.2,
      },
    ];
    const table: LanceDBTableLike = {
      add: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
      countRows: vi.fn(async () => candidates.length),
      search: vi.fn(() => {
        let limit = 0;
        const query = {
          distanceType: vi.fn(() => query),
          limit: vi.fn((value: number) => {
            limit = value;
            limits.push(value);
            return query;
          }),
          where: vi.fn(() => query),
          toArray: vi.fn(async () => candidates.slice(0, limit)),
        };
        return query;
      }),
    };
    const client: LanceDBConnectionLike = {
      openTable: vi.fn(async () => table),
      tableNames: vi.fn(async () => ["docs"]),
      createTable: vi.fn(async () => table),
    };
    const store = new LanceDBVectorClient({ client }).vectorStore<string>({
      tableName: "docs",
      dimensions: 2,
    });

    await expect(
      store.search({
        vector: [1, 0],
        topK: 1,
        filter: { type: "eq", key: "tenantId", value: "tenant-1" },
      }),
    ).resolves.toMatchObject([{ id: "b" }]);
    expect(limits).toEqual([1, 2]);
  });

  it("applies metadata filters without interpolating SQL", async () => {
    const directory = await mkdtemp(join(tmpdir(), "anvia-lancedb-filter-security-"));
    const client = new LanceDBVectorClient({ uri: directory });
    const store = client.vectorStore<string>({ tableName: "documents", dimensions: 2 });

    try {
      await store.ensure();
      await store.upsert({
        documents: [
          {
            id: "document-1",
            document: "private",
            metadata: { tenantId: "tenant-1" },
            embeddings: [{ document: "private", vector: [1, 0] }],
          },
        ],
      });

      await expect(
        store.search({
          vector: [1, 0],
          topK: 1,
          filter: {
            type: "eq",
            key: "missing') = 'ignored' OR TRUE --",
            value: "ignored",
          },
        }),
      ).resolves.toEqual([]);
      await expect(
        store.search({
          vector: [1, 0],
          topK: 1,
          filter: {
            type: "eq",
            key: "tenantId",
            value: "tenant-1' OR TRUE --",
          },
        }),
      ).resolves.toEqual([]);
      await expect(
        store.search({
          vector: [1, 0],
          topK: 1,
          filter: { type: "eq", key: "tenantId", value: "tenant-1" },
        }),
      ).resolves.toMatchObject([{ id: "document-1" }]);
    } finally {
      await client.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
