import { describe, expect, it, vi } from "vitest";
import * as publicApi from "../src/index.js";
import { type QdrantClientLike, QdrantVectorClient } from "../src/index.js";

function collectionInfo(hybrid = false) {
  return {
    result: {
      config: {
        params: hybrid
          ? { vectors: { dense: { size: 2, distance: "Cosine" } }, sparse_vectors: { sparse: {} } }
          : { vectors: { size: 2, distance: "Cosine" } },
      },
    },
  };
}

function fixture(hybrid = false): QdrantClientLike {
  return {
    getCollection: vi.fn(async () => collectionInfo(hybrid)),
    createCollection: vi.fn(async () => undefined),
    collectionExists: vi.fn(async () => ({ exists: true })),
    upsert: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    batchUpdate: vi.fn(async () => undefined),
    query: vi.fn(async () => ({
      result: {
        points: [
          {
            id: "point",
            score: 0.9,
            payload: {
              __anvia_document_id: "doc",
              __anvia_document: JSON.stringify({ text: "cat" }),
              source: "test",
            },
          },
        ],
      },
    })),
    scroll: vi.fn(async () => ({ result: { points: [], next_page_offset: null } })),
  };
}

describe("QdrantVectorClient", () => {
  it("exports dense and hybrid stores without legacy index or connect APIs", () => {
    expect(publicApi).toHaveProperty("QdrantVectorClient");
    expect(publicApi).not.toHaveProperty("QdrantVectorIndex");
    expect(publicApi.QdrantVectorStore).not.toHaveProperty("connect");
    expect(publicApi.QdrantVectorStore.prototype).not.toHaveProperty("index");
    expect(publicApi.QdrantVectorStore.prototype).not.toHaveProperty("asTool");
    expect(publicApi).toHaveProperty("QdrantHybridVectorStore");
  });
  it("creates side-effect-free handles and validates explicitly", async () => {
    const client = fixture();
    const store = new QdrantVectorClient({ client }).vectorStore({
      collectionName: "docs",
      dimensions: 2,
    });
    expect(client.getCollection).not.toHaveBeenCalled();
    await store.validate();
    expect(client.getCollection).toHaveBeenCalledOnce();
    expect("searchHybrid" in store).toBe(false);
  });

  it("replaces documents and searches with raw dense vectors", async () => {
    const client = fixture();
    const store = new QdrantVectorClient({ client }).vectorStore<{ text: string }>({
      collectionName: "docs",
      dimensions: 2,
    });
    await store.upsert({
      documents: [
        {
          id: "doc",
          document: { text: "cat" },
          embeddings: [{ document: "cat", vector: [1, 0] }],
        },
      ],
      providerOptions: { wait: true },
    });
    expect(client.batchUpdate).toHaveBeenCalledWith(
      "docs",
      expect.objectContaining({ operations: expect.any(Array) }),
    );
    await expect(store.search({ vector: [1, 0], topK: 1 })).resolves.toMatchObject([
      { id: "doc", score: 0.9, metadata: { source: "test" } },
    ]);
  });

  it("keeps hybrid search an explicit capability", async () => {
    const client = fixture(true);
    const store = new QdrantVectorClient({ client }).vectorStore({
      collectionName: "docs",
      dimensions: 2,
      mode: "hybrid",
    });
    await store.validate();
    await store.searchHybrid({
      vector: [1, 0],
      sparseVector: { indices: [1], values: [2] },
      fusion: "rrf",
      topK: 2,
    });
    expect(client.query).toHaveBeenCalledWith(
      "docs",
      expect.objectContaining({ prefetch: expect.any(Array), query: { fusion: "rrf" } }),
    );
  });

  it("normalizes Euclidean distance and translates minScore for Qdrant", async () => {
    const client = fixture();
    client.query = vi.fn(async () => ({
      result: {
        points: [
          {
            id: "near",
            score: 0.2,
            payload: { __anvia_document_id: "near", __anvia_document: "near" },
          },
        ],
      },
    }));
    const store = new QdrantVectorClient({ client }).vectorStore<string>({
      collectionName: "docs",
      dimensions: 2,
      metric: "euclidean",
    });

    await expect(store.search({ vector: [1, 0], topK: 1, minScore: -0.5 })).resolves.toEqual([
      { id: "near", document: "near", score: -0.2 },
    ]);
    expect(client.query).toHaveBeenCalledWith(
      "docs",
      expect.objectContaining({ score_threshold: 0.5 }),
    );
  });

  it("expands physical candidates until topK logical documents are available", async () => {
    const client = fixture();
    client.query = vi.fn(async (_collection, options) => {
      const points = [
        {
          id: "a-1",
          score: 0.9,
          payload: { __anvia_document_id: "a", __anvia_document: "A" },
        },
        {
          id: "a-2",
          score: 0.8,
          payload: { __anvia_document_id: "a", __anvia_document: "A" },
        },
      ];
      if (options.limit !== 2) {
        points.push(
          {
            id: "b",
            score: 0.7,
            payload: { __anvia_document_id: "b", __anvia_document: "B" },
          },
          {
            id: "c",
            score: 0.6,
            payload: { __anvia_document_id: "c", __anvia_document: "C" },
          },
        );
      }
      return { result: { points } };
    });
    const store = new QdrantVectorClient({ client }).vectorStore<string>({
      collectionName: "docs",
      dimensions: 2,
    });

    await expect(store.search({ vector: [1, 0], topK: 2 })).resolves.toMatchObject([
      { id: "a" },
      { id: "b" },
    ]);
    expect(
      (client.query as ReturnType<typeof vi.fn>).mock.calls.map(([, call]) => call.limit),
    ).toEqual([2, 4]);
  });

  it("does not close an injected native client but rejects reuse", async () => {
    const owner = new QdrantVectorClient({ client: fixture() });
    await owner.close();
    expect(() => owner.nativeClient()).toThrow("closed");
  });
});
