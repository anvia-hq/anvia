import { type Embedding, type EmbeddingModel, embedDocuments } from "@anvia/core/embeddings";
import { vectorFilter } from "@anvia/core/vector-store";
import { describe, expect, it } from "vitest";
import { filterToPineconeFilter, PineconeVectorStore } from "../src/index";

class MockEmbeddingModel implements EmbeddingModel {
  async embedTexts(texts: string[]): Promise<Embedding[]> {
    return texts.map((document) => ({
      document,
      vector: document.toLowerCase().includes("cat") ? [1, 0] : [0, 1],
    }));
  }
}

class MockNamespace {
  readonly upserts: unknown[] = [];
  readonly queries: unknown[] = [];

  async upsert(vectors: unknown): Promise<void> {
    this.upserts.push(vectors);
  }

  async query(options: unknown): Promise<unknown> {
    this.queries.push(options);
    return {
      matches: [
        {
          id: "point1",
          score: 0.9,
          metadata: {
            __anvia_document_id: "doc1",
            __anvia_document: JSON.stringify({ title: "Cat guide" }),
            kind: "animal",
          },
        },
        {
          id: "point2",
          score: 0.4,
          metadata: {
            __anvia_document_id: "doc2",
            __anvia_document: "plain dog note",
          },
        },
      ],
    };
  }
}

class MockPineconeClient {
  readonly indexes = new Set<string>();
  readonly creates: unknown[] = [];
  readonly namespaces = new Map<string, MockNamespace>();

  async listIndexes(): Promise<unknown> {
    return {};
  }

  async createIndex(options: unknown): Promise<unknown> {
    this.indexes.add((options as { name: string }).name);
    this.creates.push(options);
    return {};
  }

  index(indexName: string) {
    const ns = new MockNamespace();
    this.namespaces.set(indexName, ns);
    return {
      namespace: () => ns,
    };
  }
}

describe("PineconeVectorStore", () => {
  it("connects, upserts precomputed embeddings, and queries with Anvia embeddings", async () => {
    const client = new MockPineconeClient();
    const model = new MockEmbeddingModel();
    const store = await PineconeVectorStore.connect<{ title: string }>({
      client,
      indexName: "docs",
    });
    const ns: MockNamespace = client.namespaces.get("docs") as MockNamespace;
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

    expect(ns.upserts[0]).toMatchObject([
      {
        values: [1, 0],
        metadata: {
          __anvia_document_id: "doc1",
          __anvia_document: JSON.stringify({ id: "doc1", title: "Cat guide" }),
          kind: "animal",
        },
      },
    ]);
    expect(ns.queries[0]).toMatchObject({
      vector: [1, 0],
      topK: 2,
      filter: { kind: { $eq: "animal" } },
      includeMetadata: true,
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
      filterToPineconeFilter(
        vectorFilter.and(vectorFilter.gt("rank", 2), vectorFilter.lt("rank", 5)),
      ),
    ).toEqual({
      $and: [{ rank: { $gt: 2 } }, { rank: { $lt: 5 } }],
    });
    expect(
      filterToPineconeFilter(
        vectorFilter.or(vectorFilter.eq("a", true), vectorFilter.eq("b", false)),
      ),
    ).toEqual({
      $or: [{ a: { $eq: true } }, { b: { $eq: false } }],
    });
  });

  it("rejects documents with no embeddings", async () => {
    const client = new MockPineconeClient();
    const store = await PineconeVectorStore.connect<string>({
      client,
      indexName: "docs",
    });

    await expect(
      store.upsertDocuments([{ id: "doc1", document: "empty", embeddings: [] }]),
    ).rejects.toThrow("Document doc1 has no embeddings");
  });

  it("rejects reserved metadata keys", async () => {
    const client = new MockPineconeClient();
    const store = await PineconeVectorStore.connect<string>({
      client,
      indexName: "docs",
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
