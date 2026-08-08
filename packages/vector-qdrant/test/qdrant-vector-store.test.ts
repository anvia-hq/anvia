import type { SparseEmbedding, SparseEmbeddingModel } from "@anvia/core/embeddings";
import { type Embedding, type EmbeddingModel, embedDocuments } from "@anvia/core/embeddings";
import { vectorFilter } from "@anvia/core/vector-store";
import { describe, expect, it } from "vitest";
import { filterToQdrantFilter, QdrantVectorStore } from "../src/index";

class MockEmbeddingModel implements EmbeddingModel {
  async embedTexts(texts: string[]): Promise<Embedding[]> {
    return texts.map((document) => ({
      document,
      vector: document.toLowerCase().includes("cat") ? [1, 0] : [0, 1],
    }));
  }
}

class MockSparseEmbeddingModel implements SparseEmbeddingModel {
  async embedTexts(texts: string[]): Promise<SparseEmbedding[]> {
    return texts.map((document) => ({
      document,
      vector: { indices: [1, 2], values: [0.5, 0.25] },
    }));
  }

  async embedQuery(query: string): Promise<SparseEmbedding> {
    return { document: query, vector: { indices: [7], values: [1] } };
  }
}

class MockQdrantClient {
  readonly collections = new Set<string>();
  readonly creates: unknown[] = [];
  readonly upserts: unknown[] = [];
  readonly searches: unknown[] = [];
  readonly queries: unknown[] = [];

  async getCollection(collectionName: string): Promise<unknown> {
    if (!this.collections.has(collectionName)) {
      throw new Error("missing collection");
    }
    return { name: collectionName };
  }

  async createCollection(collectionName: string, options: unknown): Promise<unknown> {
    this.collections.add(collectionName);
    this.creates.push({ collectionName, options });
    return {};
  }

  async upsert(collectionName: string, options: unknown): Promise<unknown> {
    this.upserts.push({ collectionName, options });
    return {};
  }

  async search(collectionName: string, options: unknown): Promise<unknown> {
    this.searches.push({ collectionName, options });
    return [
      {
        id: "point1",
        score: 0.9,
        payload: {
          __anvia_document_id: "doc1",
          __anvia_document: JSON.stringify({ title: "Cat guide" }),
          kind: "animal",
        },
      },
      {
        id: "point2",
        score: 0.8,
        payload: {
          __anvia_document_id: "doc1",
          __anvia_document: JSON.stringify({ title: "Cat guide" }),
          kind: "animal",
        },
      },
      {
        id: "point3",
        score: 0.4,
        payload: {
          __anvia_document_id: "doc2",
          __anvia_document: "plain dog note",
        },
      },
    ];
  }

  async query(collectionName: string, options: unknown): Promise<unknown> {
    this.queries.push({ collectionName, options });
    if (!(options && typeof options === "object" && "prefetch" in options)) {
      return {
        points: await this.search(collectionName, options),
      };
    }
    return {
      points: [
        {
          id: "point1",
          score: 1.2,
          payload: {
            __anvia_document_id: "doc1",
            __anvia_document: JSON.stringify({ title: "Cat guide" }),
            kind: "animal",
          },
        },
      ],
    };
  }
}

describe("QdrantVectorStore", () => {
  it("creates a missing collection with vector size and default cosine distance", async () => {
    const client = new MockQdrantClient();

    await QdrantVectorStore.connect({
      client,
      collectionName: "docs",
      vectorSize: 2,
    });

    expect(client.creates[0]).toEqual({
      collectionName: "docs",
      options: {
        vectors: {
          size: 2,
          distance: "Cosine",
        },
      },
    });
  });

  it("creates a hybrid collection with named dense and sparse vectors", async () => {
    const client = new MockQdrantClient();

    await QdrantVectorStore.connect({
      client,
      collectionName: "hybrid_docs",
      vectorSize: 2,
      hybrid: true,
    });

    expect(client.creates[0]).toEqual({
      collectionName: "hybrid_docs",
      options: {
        vectors: {
          dense: {
            size: 2,
            distance: "Cosine",
          },
        },
        sparse_vectors: {
          sparse: {},
        },
      },
    });
  });

  it("upserts hybrid points and searches with prefetch RRF", async () => {
    const client = new MockQdrantClient();
    const dense = new MockEmbeddingModel();
    const sparse = new MockSparseEmbeddingModel();
    const store = await QdrantVectorStore.connect<{ title: string }>({
      client,
      collectionName: "hybrid_docs",
      vectorSize: 2,
      hybrid: true,
    });

    await store.upsertDocuments([
      {
        id: "doc1",
        document: { title: "Cat guide" },
        embeddings: [{ document: "Cat guide", vector: [1, 0] }],
        sparseEmbeddings: [
          { document: "Cat guide", vector: { indices: [1, 2], values: [0.5, 0.25] } },
        ],
        metadata: { kind: "animal" },
      },
    ]);

    const results = await store.index({ dense, sparse }).search({
      query: "cat",
      topK: 2,
    });

    expect(client.upserts[0]).toMatchObject({
      options: {
        points: [
          {
            vector: {
              dense: [1, 0],
              sparse: { indices: [1, 2], values: [0.5, 0.25] },
            },
          },
        ],
      },
    });
    expect(client.searches).toEqual([]);
    expect(client.queries[0]).toMatchObject({
      collectionName: "hybrid_docs",
      options: {
        prefetch: [
          { query: [1, 0], using: "dense", limit: 10 },
          { query: { indices: [7], values: [1] }, using: "sparse", limit: 10 },
        ],
        query: { fusion: "rrf" },
        limit: 2,
        with_payload: true,
      },
    });
    expect(results).toEqual([
      {
        id: "doc1",
        score: 1.2,
        document: { title: "Cat guide" },
        metadata: { kind: "animal" },
      },
    ]);
  });

  it("rejects hybrid index on dense-only collections", async () => {
    const client = new MockQdrantClient();
    const store = await QdrantVectorStore.connect({
      client,
      collectionName: "docs",
      vectorSize: 2,
    });

    expect(() =>
      store.index({
        dense: new MockEmbeddingModel(),
        sparse: new MockSparseEmbeddingModel(),
      }),
    ).toThrow("hybrid: true");
  });

  it("rejects dense-only index on hybrid collections", async () => {
    const client = new MockQdrantClient();
    const store = await QdrantVectorStore.connect({
      client,
      collectionName: "hybrid_docs",
      vectorSize: 2,
      hybrid: true,
    });

    expect(() => store.index(new MockEmbeddingModel())).toThrow("dense, sparse");
  });

  it("rejects hybrid upsert without sparse embeddings", async () => {
    const client = new MockQdrantClient();
    const store = await QdrantVectorStore.connect({
      client,
      collectionName: "hybrid_docs",
      vectorSize: 2,
      hybrid: true,
    });

    await expect(
      store.upsertDocuments([
        {
          id: "doc1",
          document: "missing sparse",
          embeddings: [{ document: "missing sparse", vector: [1, 0] }],
        },
      ]),
    ).rejects.toThrow("sparseEmbeddings");
  });

  it("respects createIfMissing false", async () => {
    const client = new MockQdrantClient();
    client.collections.add("docs");

    await QdrantVectorStore.connect({
      client,
      collectionName: "docs",
      vectorSize: 2,
      createIfMissing: false,
    });

    expect(client.creates).toEqual([]);
  });

  it("upserts precomputed embeddings and queries with Anvia embeddings", async () => {
    const client = new MockQdrantClient();
    const model = new MockEmbeddingModel();
    const store = await QdrantVectorStore.connect<{ title: string }>({
      client,
      collectionName: "docs",
      vectorSize: 2,
    });
    const embedded = await embedDocuments(model, [{ id: "doc1", title: "Cat guide" }], {
      id: (doc) => doc.id,
      content: (doc) => doc.title,
      metadata: () => ({ kind: "animal" }),
    });

    await store.upsertDocuments(embedded);
    const results = await store.index(model).search({
      query: "cat",
      topK: 2,
      threshold: 0.5,
      filter: vectorFilter.eq("kind", "animal"),
    });

    expect(client.upserts[0]).toMatchObject({
      collectionName: "docs",
      options: {
        points: [
          {
            vector: [1, 0],
            payload: {
              __anvia_document_id: "doc1",
              __anvia_document: JSON.stringify({ id: "doc1", title: "Cat guide" }),
              kind: "animal",
            },
          },
        ],
      },
    });
    expect(client.queries[0]).toMatchObject({
      collectionName: "docs",
      options: {
        query: [1, 0],
        limit: 2,
        filter: { must: [{ key: "kind", match: { value: "animal" } }] },
        with_payload: true,
      },
    });
    expect(results).toEqual([
      {
        id: "doc1",
        score: 0.9,
        document: { title: "Cat guide" },
        metadata: { kind: "animal" },
      },
    ]);
  });

  it("falls back to the legacy search API for custom clients", async () => {
    const backend = new MockQdrantClient();
    const client = {
      getCollection: backend.getCollection.bind(backend),
      createCollection: backend.createCollection.bind(backend),
      upsert: backend.upsert.bind(backend),
      search: backend.search.bind(backend),
    };
    const store = await QdrantVectorStore.connect<string>({
      client,
      collectionName: "docs",
      vectorSize: 2,
    });

    await store.index(new MockEmbeddingModel()).search({ query: "cat", topK: 1 });

    expect(backend.searches[0]).toMatchObject({
      collectionName: "docs",
      options: {
        vector: [1, 0],
        limit: 1,
        with_payload: true,
      },
    });
  });

  it("handles multiple embeddings with stable logical ids", async () => {
    const client = new MockQdrantClient();
    const store = await QdrantVectorStore.connect<string>({
      client,
      collectionName: "docs",
      vectorSize: 2,
    });

    await store.upsertDocuments([
      {
        id: "doc1",
        document: "split document",
        embeddings: [
          { document: "cat half", vector: [1, 0] },
          { document: "dog half", vector: [0, 1] },
        ],
      },
    ]);

    const points = (
      client.upserts[0] as {
        options: { points: Array<{ id: string; payload: Record<string, unknown> }> };
      }
    ).options.points;
    expect(points).toHaveLength(2);
    expect(points[0]?.id).toMatch(/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/);
    expect(points[1]?.id).toMatch(/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/);
    expect(points[0]?.id).not.toBe(points[1]?.id);
    expect(points.map((point) => point.payload.__anvia_document_id)).toEqual(["doc1", "doc1"]);
  });

  it("translates compound filters", () => {
    expect(
      filterToQdrantFilter(
        vectorFilter.and(vectorFilter.gt("rank", 2), vectorFilter.lt("rank", 5)),
      ),
    ).toEqual({
      must: [
        { must: [{ key: "rank", range: { gt: 2 } }] },
        { must: [{ key: "rank", range: { lt: 5 } }] },
      ],
    });
    expect(
      filterToQdrantFilter(
        vectorFilter.or(vectorFilter.eq("a", true), vectorFilter.eq("b", false)),
      ),
    ).toEqual({
      should: [
        { must: [{ key: "a", match: { value: true } }] },
        { must: [{ key: "b", match: { value: false } }] },
      ],
    });
  });

  it("omits metadata payload fields when documents do not provide metadata", async () => {
    const client = new MockQdrantClient();
    const model = new MockEmbeddingModel();
    const store = await QdrantVectorStore.connect<{ title: string }>({
      client,
      collectionName: "docs",
      vectorSize: 2,
    });
    const embedded = await embedDocuments(model, [{ id: "doc1", title: "Cat guide" }], {
      id: (doc) => doc.id,
      content: (doc) => doc.title,
    });

    await store.upsertDocuments(embedded);

    expect(client.upserts[0]).toMatchObject({
      options: {
        points: [
          {
            payload: {
              __anvia_document_id: "doc1",
              __anvia_document: JSON.stringify({ id: "doc1", title: "Cat guide" }),
            },
          },
        ],
      },
    });
    expect(
      (
        client.upserts[0] as {
          options: { points: Array<{ payload: Record<string, unknown> }> };
        }
      ).options.points[0]?.payload,
    ).not.toHaveProperty("kind");
  });

  it("handles search results without payloads", async () => {
    const client = new MockQdrantClient();
    client.query = async () => ({
      points: [{ id: "point-without-payload", score: 0.7 }],
    });
    const model = new MockEmbeddingModel();
    const store = await QdrantVectorStore.connect<string>({
      client,
      collectionName: "docs",
      vectorSize: 2,
    });

    const results = await store.index(model).search({ query: "cat", topK: 1 });

    expect(results).toEqual([
      {
        id: "point-without-payload",
        score: 0.7,
        document: "",
      },
    ]);
    expect(results[0]).not.toHaveProperty("metadata");
  });

  it("rejects documents with no embeddings", async () => {
    const client = new MockQdrantClient();
    const store = await QdrantVectorStore.connect<string>({
      client,
      collectionName: "docs",
      vectorSize: 2,
    });

    await expect(
      store.upsertDocuments([{ id: "doc1", document: "empty", embeddings: [] }]),
    ).rejects.toThrow("Document doc1 has no embeddings");
  });

  it("rejects reserved metadata keys", async () => {
    const client = new MockQdrantClient();
    const store = await QdrantVectorStore.connect<string>({
      client,
      collectionName: "docs",
      vectorSize: 2,
    });

    await expect(
      store.upsertDocuments([
        {
          id: "doc1",
          document: "reserved",
          metadata: { __anvia_document_id: "bad" },
          embeddings: [{ document: "reserved", vector: [1, 0] }],
        },
      ]),
    ).rejects.toThrow("Metadata key __anvia_document_id is reserved");
  });
});
