import { describe, expect, it, vi } from "vitest";
import * as publicApi from "../src/index.js";
import { type RedisClientLike, RedisVectorClient } from "../src/index.js";

describe("RedisVectorClient", () => {
  it("exports the client without legacy index or connect APIs", () => {
    expect(publicApi).toHaveProperty("RedisVectorClient");
    expect(publicApi).not.toHaveProperty("RedisVectorIndex");
    expect(publicApi.RedisVectorStore).not.toHaveProperty("connect");
    expect(publicApi.RedisVectorStore.prototype).not.toHaveProperty("index");
    expect(publicApi.RedisVectorStore.prototype).not.toHaveProperty("asTool");
  });
  it("keeps construction lazy and replaces indexed hashes", async () => {
    const search = vi.fn(async (_name: string, query: string) =>
      query.includes("KNN")
        ? {
            documents: [
              {
                id: "key",
                value: {
                  __anvia_document_id: "doc",
                  __anvia_document: JSON.stringify({ text: "cat" }),
                  __anvia_score: 0.1,
                },
              },
            ],
          }
        : { documents: [{ id: "key" }] },
    );
    const client: RedisClientLike = {
      ft: { create: vi.fn(async () => undefined), info: vi.fn(async () => ({})), search },
      hSet: vi.fn(async () => undefined),
      expire: vi.fn(async () => undefined),
      del: vi.fn(async () => undefined),
    };
    const store = new RedisVectorClient({ client }).vectorStore<{ text: string }>({
      indexName: "docs",
      dimensions: 2,
    });
    expect(client.ft.info).not.toHaveBeenCalled();
    await store.validate();
    await store.upsert({
      documents: [
        { id: "doc", document: { text: "cat" }, embeddings: [{ document: "cat", vector: [1, 0] }] },
      ],
    });
    expect(client.del).toHaveBeenCalledWith(["key"]);
    expect(client.hSet).toHaveBeenCalled();
    await store.search({ vector: [1, 0], topK: 1 });
    expect(search.mock.calls.some(([, query]) => query.includes("KNN"))).toBe(true);
  });

  it("provisions declared metadata fields and uses them for filters", async () => {
    const info = vi
      .fn()
      .mockRejectedValueOnce(new Error("Unknown index name"))
      .mockResolvedValue({});
    const search = vi.fn(async (_name: string, query: string) =>
      query.includes("KNN")
        ? {
            documents: [
              {
                id: "key",
                value: {
                  __anvia_document_id: "doc",
                  __anvia_document: "doc",
                  __anvia_metadata: JSON.stringify({ tenantId: "tenant-1", priority: 2 }),
                  __anvia_score: 0.1,
                },
              },
            ],
          }
        : { documents: [] },
    );
    const client: RedisClientLike = {
      ft: { create: vi.fn(async () => undefined), info, search },
      hSet: vi.fn(async () => undefined),
      expire: vi.fn(async () => undefined),
      del: vi.fn(async () => undefined),
    };
    const store = new RedisVectorClient({ client }).vectorStore<string>({
      indexName: "docs",
      dimensions: 2,
      metadataSchema: { tenantId: "tag", priority: "numeric" },
    });

    await store.ensure();
    expect(client.ft.create).toHaveBeenCalledWith(
      "docs",
      expect.objectContaining({
        tenantId: expect.objectContaining({ type: "TAG" }),
        priority: expect.objectContaining({ type: "NUMERIC" }),
      }),
      expect.anything(),
    );
    await store.upsert({
      documents: [
        {
          id: "doc",
          document: "doc",
          metadata: { tenantId: "tenant-1", priority: 2 },
          embeddings: [{ document: "doc", vector: [1, 0] }],
        },
      ],
    });
    expect(client.hSet).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        __anvia_metadata: JSON.stringify({ tenantId: "tenant-1", priority: 2 }),
        tenantId: "s:tenant-1",
        priority: 2,
      }),
    );
    await expect(
      store.search({
        vector: [1, 0],
        topK: 1,
        filter: { type: "eq", key: "tenantId", value: "tenant-1" },
      }),
    ).resolves.toMatchObject([{ id: "doc", metadata: { tenantId: "tenant-1", priority: 2 } }]);
    expect(search.mock.calls.at(-1)?.[1]).toContain("@tenantId:{s\\:tenant\\-1}");
  });

  it("rejects filters for metadata fields that were not declared", async () => {
    const client: RedisClientLike = {
      ft: {
        create: vi.fn(async () => undefined),
        info: vi.fn(async () => ({})),
        search: vi.fn(async () => ({ documents: [] })),
      },
      hSet: vi.fn(async () => undefined),
      expire: vi.fn(async () => undefined),
      del: vi.fn(async () => undefined),
    };
    const store = new RedisVectorClient({ client }).vectorStore({
      indexName: "docs",
      dimensions: 2,
    });

    await expect(
      store.search({
        vector: [1, 0],
        topK: 1,
        filter: { type: "eq", key: "tenantId", value: "tenant-1" },
      }),
    ).rejects.toThrow("metadataSchema");
  });

  it("expands physical candidates until topK logical documents are available", async () => {
    const limits: number[] = [];
    const search = vi.fn(async (_name: string, query: string) => {
      if (!query.includes("KNN")) return { documents: [] };
      const limit = Number(query.match(/KNN (\d+)/)?.[1]);
      limits.push(limit);
      const candidates = [
        {
          id: "a-1",
          value: { __anvia_document_id: "a", __anvia_document: "A", __anvia_score: 0.1 },
        },
        {
          id: "a-2",
          value: { __anvia_document_id: "a", __anvia_document: "A", __anvia_score: 0.2 },
        },
        { id: "b", value: { __anvia_document_id: "b", __anvia_document: "B", __anvia_score: 0.3 } },
        { id: "c", value: { __anvia_document_id: "c", __anvia_document: "C", __anvia_score: 0.4 } },
      ];
      return { documents: candidates.slice(0, limit) };
    });
    const client: RedisClientLike = {
      ft: { create: vi.fn(async () => undefined), info: vi.fn(async () => ({})), search },
      hSet: vi.fn(async () => undefined),
      expire: vi.fn(async () => undefined),
      del: vi.fn(async () => undefined),
    };
    const store = new RedisVectorClient({ client }).vectorStore<string>({
      indexName: "docs",
      dimensions: 2,
    });

    await expect(store.search({ vector: [1, 0], topK: 2 })).resolves.toMatchObject([
      { id: "a" },
      { id: "b" },
    ]);
    expect(limits).toEqual([2, 4]);
  });
});
