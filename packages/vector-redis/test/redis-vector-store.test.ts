import { type Embedding, type EmbeddingModel, embedDocuments } from "@anvia/core/embeddings";
import { vectorFilter } from "@anvia/core/vector-store";
import { describe, expect, it } from "vitest";
import { filterToRedisQuery, RedisVectorStore } from "../src/index";
import { SchemaFieldTypes, VectorAlgorithms } from "../src/types";

class MockEmbeddingModel implements EmbeddingModel {
  async embedTexts(texts: string[]): Promise<Embedding[]> {
    return texts.map((document) => ({
      document,
      vector: document.toLowerCase().includes("cat") ? [1, 0] : [0, 1],
    }));
  }
}

class MockRedisClient {
  readonly indices = new Map<
    string,
    { schema: Record<string, unknown>; options?: Record<string, unknown> }
  >();
  readonly hashes = new Map<string, Record<string, unknown>>();
  readonly creates: unknown[] = [];
  readonly searches: unknown[] = [];

  ft = {
    create: async (
      indexName: string,
      schema: Record<string, unknown>,
      options?: Record<string, unknown>,
    ) => {
      const index: { schema: Record<string, unknown>; options?: Record<string, unknown> } = {
        schema,
      };
      if (options !== undefined) {
        index.options = options;
      }
      this.indices.set(indexName, index);
      this.creates.push({ indexName, schema, options });
      return {};
    },
    search: async (indexName: string, query: string, options?: Record<string, unknown>) => {
      this.searches.push({ indexName, query, options });
      return {
        total: 2,
        documents: [
          {
            id: "anvia:docs:abc123",
            value: {
              __anvia_document_id: "doc1",
              __anvia_document: JSON.stringify({ title: "Cat guide" }),
              kind: "animal",
              score: "0.9",
            },
          },
          {
            id: "anvia:docs:def456",
            value: {
              __anvia_document_id: "doc2",
              __anvia_document: "plain dog note",
              score: "0.4",
            },
          },
        ],
      };
    },
    dropindex: async (_indexName: string) => ({}),
    info: async (indexName: string) => {
      if (!this.indices.has(indexName)) {
        throw new Error("Unknown index name");
      }
      return {};
    },
  };

  hSet = async (key: string, fieldValues: Record<string, unknown>) => {
    this.hashes.set(key, fieldValues);
    return {};
  };

  expire = async (_key: string, _seconds: number) => ({});
}

describe("RedisVectorStore", () => {
  it("creates a missing index with vector size and default cosine distance", async () => {
    const client = new MockRedisClient();

    await RedisVectorStore.connect({
      client,
      indexName: "docs_idx",
      vectorSize: 2,
    });

    expect(client.creates[0]).toMatchObject({
      indexName: "docs_idx",
      options: { ON: "HASH", PREFIX: "anvia:docs_idx:" },
    });
    const schema = (client.creates[0] as { schema: Record<string, unknown> }).schema;
    expect(schema.__anvia_document_id).toEqual({ type: SchemaFieldTypes.TEXT });
    expect(schema.__anvia_document).toEqual({ type: SchemaFieldTypes.TEXT });
    const vectorConfig = schema.__anvia_vector as Record<string, unknown>;
    expect(vectorConfig.ALGORITHM).toBe(VectorAlgorithms.HNSW);
    expect(vectorConfig.DIM).toBe(2);
    expect(vectorConfig.DISTANCE_METRIC).toBe("COSINE");
  });

  it("respects createIfMissing false", async () => {
    const client = new MockRedisClient();
    client.indices.set("docs_idx", { schema: {} });

    await RedisVectorStore.connect({
      client,
      indexName: "docs_idx",
      vectorSize: 2,
      createIfMissing: false,
    });

    expect(client.creates).toEqual([]);
  });

  it("upserts precomputed embeddings and queries with Anvia embeddings", async () => {
    const client = new MockRedisClient();
    const model = new MockEmbeddingModel();
    const store = await RedisVectorStore.connect<{ title: string }>({
      client,
      indexName: "docs_idx",
      vectorSize: 2,
    });
    const embedded = await embedDocuments(model, [{ id: "doc1", title: "Cat guide" }], {
      id: (doc: { id: string; title: string }) => doc.id,
      content: (doc: { id: string; title: string }) => doc.title,
      metadata: () => ({ kind: "animal" }),
    });

    await store.upsertDocuments(embedded);
    const results = await store.index(model).search({
      query: "cat",
      topK: 2,
      threshold: 0.5,
      filter: vectorFilter.eq("kind", "animal"),
    });

    expect(client.hashes.size).toBe(1);
    const hashEntries = Array.from(client.hashes.values());
    expect(hashEntries.length).toBe(1);
    // biome-ignore lint/style/noNonNullAssertion: test assertion above guarantees existence
    const fields: Record<string, unknown> = hashEntries[0]!;
    expect(fields.__anvia_document_id).toBe("doc1");
    expect(fields.__anvia_document).toBe(JSON.stringify({ id: "doc1", title: "Cat guide" }));
    expect(fields.kind).toBe("animal");
    expect(fields.__anvia_vector).toBeInstanceOf(Buffer);

    expect(client.searches[0]).toMatchObject({
      indexName: "docs_idx",
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

  it("rejects documents with no embeddings", async () => {
    const client = new MockRedisClient();
    const store = await RedisVectorStore.connect<string>({
      client,
      indexName: "docs_idx",
      vectorSize: 2,
    });

    await expect(
      store.upsertDocuments([{ id: "doc1", document: "empty", embeddings: [] }]),
    ).rejects.toThrow("Document doc1 has no embeddings");
  });

  it("rejects reserved metadata keys", async () => {
    const client = new MockRedisClient();
    const store = await RedisVectorStore.connect<string>({
      client,
      indexName: "docs_idx",
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

describe("filterToRedisQuery", () => {
  it("returns * for undefined filter", () => {
    expect(filterToRedisQuery(undefined)).toBe("*");
  });

  it("translates eq filter with string value", () => {
    expect(filterToRedisQuery(vectorFilter.eq("kind", "animal"))).toBe('(@kind:"animal")');
  });

  it("translates gt and lt filters", () => {
    expect(filterToRedisQuery(vectorFilter.gt("rank", 2))).toBe("(@rank:[(2 +inf])");
    expect(filterToRedisQuery(vectorFilter.lt("rank", 5))).toBe("(@rank:[-inf (5])");
  });

  it("translates compound filters", () => {
    expect(
      filterToRedisQuery(vectorFilter.and(vectorFilter.gt("rank", 2), vectorFilter.lt("rank", 5))),
    ).toBe("((@rank:[(2 +inf]) (@rank:[-inf (5]))");
    expect(
      filterToRedisQuery(vectorFilter.or(vectorFilter.eq("a", "x"), vectorFilter.eq("b", "y"))),
    ).toBe('((@a:"x") | (@b:"y"))');
  });
});
