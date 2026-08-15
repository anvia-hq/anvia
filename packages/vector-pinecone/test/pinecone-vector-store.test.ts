import { describe, expect, it, vi } from "vitest";
import * as publicApi from "../src/index.js";
import {
  type PineconeClientLike,
  type PineconeNamespaceLike,
  PineconeVectorClient,
} from "../src/index.js";

describe("PineconeVectorClient", () => {
  it("exports the client without legacy index or connect APIs", () => {
    expect(publicApi).toHaveProperty("PineconeVectorClient");
    expect(publicApi).not.toHaveProperty("PineconeVectorIndex");
    expect(publicApi.PineconeVectorStore).not.toHaveProperty("connect");
    expect(publicApi.PineconeVectorStore.prototype).not.toHaveProperty("index");
    expect(publicApi.PineconeVectorStore.prototype).not.toHaveProperty("asTool");
  });
  it("provisions explicitly and uses raw-vector store operations", async () => {
    const namespace: PineconeNamespaceLike = {
      deleteMany: vi.fn(async () => undefined),
      upsert: vi.fn(async () => undefined),
      query: vi.fn(async () => ({
        matches: [
          {
            id: "point",
            score: 0.9,
            metadata: {
              __anvia_document_id: "doc",
              __anvia_document: JSON.stringify({ text: "cat" }),
            },
          },
        ],
      })),
    };
    const client: PineconeClientLike = {
      listIndexes: vi.fn(async () => ({ indexes: [{ name: "docs" }] })),
      createIndex: vi.fn(async () => undefined),
      index: vi.fn(() => ({ namespace: () => namespace })),
    };
    const store = new PineconeVectorClient({ client }).vectorStore<{ text: string }>({
      indexName: "docs",
      dimensions: 2,
    });
    expect(client.listIndexes).not.toHaveBeenCalled();
    await store.validate();
    await store.upsert({
      documents: [
        { id: "doc", document: { text: "cat" }, embeddings: [{ document: "cat", vector: [1, 0] }] },
      ],
    });
    expect(namespace.deleteMany).toHaveBeenCalled();
    expect(namespace.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        records: [expect.objectContaining({ id: expect.any(String), values: [1, 0] })],
      }),
    );
    await store.search({ vector: [1, 0], topK: 1 });
    expect(namespace.query).toHaveBeenCalledWith(expect.objectContaining({ vector: [1, 0] }));
  });

  it("normalizes Euclidean distance so larger scores are better", async () => {
    const namespace: PineconeNamespaceLike = {
      deleteMany: vi.fn(async () => undefined),
      upsert: vi.fn(async () => undefined),
      query: vi.fn(async () => ({
        matches: [
          {
            id: "near",
            score: 0.2,
            metadata: { __anvia_document_id: "near", __anvia_document: "near" },
          },
          {
            id: "far",
            score: 0.8,
            metadata: { __anvia_document_id: "far", __anvia_document: "far" },
          },
        ],
      })),
    };
    const client: PineconeClientLike = {
      listIndexes: vi.fn(async () => ({ indexes: [{ name: "docs" }] })),
      createIndex: vi.fn(async () => undefined),
      index: vi.fn(() => ({ namespace: () => namespace })),
    };
    const store = new PineconeVectorClient({ client }).vectorStore<string>({
      indexName: "docs",
      dimensions: 2,
      metric: "euclidean",
    });

    await expect(store.search({ vector: [1, 0], topK: 2, minScore: -0.5 })).resolves.toEqual([
      { id: "near", document: "near", score: -0.2 },
    ]);
  });

  it("expands physical candidates until topK logical documents are available", async () => {
    const query = vi.fn(async (options: Record<string, unknown>) => ({
      matches: [
        {
          id: "a-1",
          score: 0.9,
          metadata: { __anvia_document_id: "a", __anvia_document: "A" },
        },
        {
          id: "a-2",
          score: 0.8,
          metadata: { __anvia_document_id: "a", __anvia_document: "A" },
        },
        ...(options.topK === 2
          ? []
          : [
              {
                id: "b",
                score: 0.7,
                metadata: { __anvia_document_id: "b", __anvia_document: "B" },
              },
              {
                id: "c",
                score: 0.6,
                metadata: { __anvia_document_id: "c", __anvia_document: "C" },
              },
            ]),
      ],
    }));
    const namespace: PineconeNamespaceLike = {
      deleteMany: vi.fn(async () => undefined),
      upsert: vi.fn(async () => undefined),
      query,
    };
    const client: PineconeClientLike = {
      listIndexes: vi.fn(async () => ({ indexes: [{ name: "docs" }] })),
      createIndex: vi.fn(async () => undefined),
      index: vi.fn(() => ({ namespace: () => namespace })),
    };
    const store = new PineconeVectorClient({ client }).vectorStore<string>({
      indexName: "docs",
      dimensions: 2,
    });

    await expect(store.search({ vector: [1, 0], topK: 2 })).resolves.toMatchObject([
      { id: "a" },
      { id: "b" },
    ]);
    expect(query.mock.calls.map(([options]) => options.topK)).toEqual([2, 4]);
  });
});
