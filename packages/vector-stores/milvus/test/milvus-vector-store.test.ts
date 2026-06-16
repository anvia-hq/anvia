import { type Embedding, type EmbeddingModel, embedDocuments } from "@anvia/core/embeddings";
import { vectorFilter } from "@anvia/core/vector-store";
import { describe, expect, it } from "vitest";
import { filterToMilvusExpr, MilvusVectorStore } from "../src/index";

class MockEmbeddingModel implements EmbeddingModel {
  async embedTexts(texts: string[]): Promise<Embedding[]> {
    return texts.map((document) => ({
      document,
      vector: document.toLowerCase().includes("cat") ? [1, 0] : [0, 1],
    }));
  }
}

class MockMilvusClient {
  readonly collections = new Set<string>();
  readonly creates: unknown[] = [];
  readonly indexCreates: unknown[] = [];
  readonly inserts: unknown[] = [];
  readonly searches: unknown[] = [];

  async hasCollection(options: { collection_name: string }): Promise<{ value: boolean }> {
    return { value: this.collections.has(options.collection_name) };
  }

  async createCollection(options: Record<string, unknown>): Promise<unknown> {
    this.collections.add(options.collection_name as string);
    this.creates.push(options);
    return {};
  }

  async createIndex(options: Record<string, unknown>): Promise<unknown> {
    this.indexCreates.push(options);
    return {};
  }

  async loadCollection(): Promise<unknown> {
    return {};
  }

  async insert(options: Record<string, unknown>): Promise<unknown> {
    this.inserts.push(options);
    return {};
  }

  async search(options: Record<string, unknown>): Promise<unknown> {
    this.searches.push(options);
    return {
      results: [
        [
          {
            id: "point1",
            score: 0.9,
            __anvia_document_id: "doc1",
            __anvia_document: JSON.stringify({ title: "Cat guide" }),
            kind: "animal",
          },
          {
            id: "point2",
            score: 0.4,
            __anvia_document_id: "doc2",
            __anvia_document: "plain dog note",
          },
        ],
      ],
    };
  }
}

describe("MilvusVectorStore", () => {
  it("creates a missing collection with vector size and default COSINE metric", async () => {
    const client = new MockMilvusClient();

    await MilvusVectorStore.connect({
      client,
      collectionName: "docs",
      vectorSize: 2,
    });

    expect(client.creates[0]).toMatchObject({
      collection_name: "docs",
      metric_type: "COSINE",
    });
    expect(client.indexCreates[0]).toMatchObject({
      collection_name: "docs",
      field_name: "vector",
      index_type: "HNSW",
      metric_type: "COSINE",
    });
  });

  it("respects createIfMissing false", async () => {
    const client = new MockMilvusClient();
    client.collections.add("docs");

    await MilvusVectorStore.connect({
      client,
      collectionName: "docs",
      vectorSize: 2,
      createIfMissing: false,
    });

    expect(client.creates).toEqual([]);
  });

  it("upserts precomputed embeddings and queries with Anvia embeddings", async () => {
    const client = new MockMilvusClient();
    const model = new MockEmbeddingModel();
    const store = await MilvusVectorStore.connect<{ title: string }>({
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

    expect(client.inserts[0]).toMatchObject({
      collection_name: "docs",
      data: [
        {
          vector: [1, 0],
          __anvia_document_id: "doc1",
          __anvia_document: JSON.stringify({ id: "doc1", title: "Cat guide" }),
          kind: "animal",
        },
      ],
    });
    expect(client.searches[0]).toMatchObject({
      collection_name: "docs",
      vector: [[1, 0]],
      limit: 2,
      filter: 'kind == "animal"',
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

  it("translates compound filters", () => {
    expect(
      filterToMilvusExpr(vectorFilter.and(vectorFilter.gt("rank", 2), vectorFilter.lt("rank", 5))),
    ).toEqual("(rank > 2) && (rank < 5)");
    expect(
      filterToMilvusExpr(vectorFilter.or(vectorFilter.eq("a", true), vectorFilter.eq("b", false))),
    ).toEqual("(a == true) || (b == false)");
  });

  it("rejects documents with no embeddings", async () => {
    const client = new MockMilvusClient();
    const store = await MilvusVectorStore.connect<string>({
      client,
      collectionName: "docs",
      vectorSize: 2,
    });

    await expect(
      store.upsertDocuments([{ id: "doc1", document: "empty", embeddings: [] }]),
    ).rejects.toThrow("Document doc1 has no embeddings");
  });

  it("rejects reserved metadata keys", async () => {
    const client = new MockMilvusClient();
    const store = await MilvusVectorStore.connect<string>({
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
