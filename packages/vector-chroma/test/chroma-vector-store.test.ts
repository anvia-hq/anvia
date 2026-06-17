import { type Embedding, type EmbeddingModel, embedDocuments } from "@anvia/core/embeddings";
import { vectorFilter } from "@anvia/core/vector-store";
import { describe, expect, it } from "vitest";
import { ChromaVectorStore, filterToChromaWhere } from "../src/index";

class MockEmbeddingModel implements EmbeddingModel {
  async embedTexts(texts: string[]): Promise<Embedding[]> {
    return texts.map((document) => ({
      document,
      vector: document.toLowerCase().includes("cat") ? [1, 0] : [0, 1],
    }));
  }
}

class MockCollection {
  readonly upserts: unknown[] = [];
  readonly queries: unknown[] = [];

  async upsert(options: unknown): Promise<void> {
    this.upserts.push(options);
  }

  async query(options: unknown): Promise<unknown> {
    this.queries.push(options);
    return {
      ids: [["doc1", "doc2"]],
      documents: [[JSON.stringify({ title: "Cat guide" }), "plain dog note"]],
      metadatas: [[{ kind: "animal" }, null]],
      distances: [[0.1, 0.8]],
    };
  }
}

describe("ChromaVectorStore", () => {
  it("connects, upserts precomputed embeddings, and queries with Anvia embeddings", async () => {
    const collection = new MockCollection();
    const client = {
      async getOrCreateCollection(options: unknown) {
        expect(options).toMatchObject({
          name: "docs",
          metadata: { "hnsw:space": "cosine" },
          embeddingFunction: null,
        });
        return collection;
      },
      async getCollection() {
        return collection;
      },
      async createCollection() {
        return collection;
      },
    };
    const model = new MockEmbeddingModel();
    const store = await ChromaVectorStore.connect<{ title: string }>({
      client,
      collectionName: "docs",
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

    expect(collection.upserts[0]).toMatchObject({
      ids: ["doc1"],
      metadatas: [{ kind: "animal" }],
      embeddings: [[1, 0]],
    });
    expect(collection.queries[0]).toMatchObject({
      queryEmbeddings: [[1, 0]],
      nResults: 2,
      where: { kind: { $eq: "animal" } },
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
      filterToChromaWhere(vectorFilter.and(vectorFilter.gt("rank", 2), vectorFilter.lt("rank", 5))),
    ).toEqual({
      $and: [{ rank: { $gt: 2 } }, { rank: { $lt: 5 } }],
    });
  });

  it("omits Chroma metadatas when documents do not provide metadata", async () => {
    const collection = new MockCollection();
    const client = {
      async getOrCreateCollection() {
        return collection;
      },
      async getCollection() {
        return collection;
      },
      async createCollection() {
        return collection;
      },
    };
    const model = new MockEmbeddingModel();
    const store = await ChromaVectorStore.connect<{ title: string }>({
      client,
      collectionName: "docs",
    });
    const embedded = await embedDocuments(model, [{ id: "doc1", title: "Cat guide" }], {
      id: (doc) => doc.id,
      content: (doc) => doc.title,
    });

    await store.upsertDocuments(embedded);

    expect(collection.upserts[0]).toMatchObject({
      ids: ["doc1"],
      embeddings: [[1, 0]],
    });
    expect(collection.upserts[0]).not.toHaveProperty("metadatas");
  });
});
