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

class MockQdrantClient {
  readonly collections = new Set<string>();
  readonly creates: unknown[] = [];
  readonly upserts: unknown[] = [];
  readonly searches: unknown[] = [];

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
    expect(client.searches[0]).toMatchObject({
      collectionName: "docs",
      options: {
        vector: [1, 0],
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
    client.search = async () => [{ id: "point-without-payload", score: 0.7 }];
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
