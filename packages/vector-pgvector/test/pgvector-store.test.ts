import { type Embedding, type EmbeddingModel, embedDocuments } from "@anvia/core/embeddings";
import { vectorFilter } from "@anvia/core/vector-store";
import { describe, expect, it } from "vitest";
import { filterToPgVectorWhere, PgVectorStore } from "../src/index";

class MockEmbeddingModel implements EmbeddingModel {
  async embedTexts(texts: string[]): Promise<Embedding[]> {
    return texts.map((document) => ({
      document,
      vector: document.toLowerCase().includes("cat") ? [1, 0] : [0, 1],
    }));
  }
}

class MockPgClient {
  readonly queries: Array<{ text: string; values: readonly unknown[] | undefined }> = [];
  searchRows: unknown[] = [
    {
      id: "point1",
      document_id: "doc1",
      document: { title: "Cat guide" },
      metadata: { kind: "animal" },
      distance: 0.1,
    },
    {
      id: "point2",
      document_id: "doc1",
      document: { title: "Cat guide" },
      metadata: { kind: "animal" },
      distance: 0.2,
    },
    {
      id: "point3",
      document_id: "doc2",
      document: "plain dog note",
      metadata: null,
      distance: 0.6,
    },
  ];

  async query(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: Record<string, unknown>[] }> {
    this.queries.push({ text, values });
    if (text.includes("pg_attribute")) {
      return { rows: [{ vector_size: 2 }] };
    }
    if (text.includes("SELECT id, document_id")) {
      return { rows: this.searchRows as Record<string, unknown>[] };
    }
    return { rows: [] };
  }
}

describe("PgVectorStore", () => {
  it("creates extension and table with vector size by default", async () => {
    const client = new MockPgClient();

    await PgVectorStore.connect({
      client,
      tableName: "docs",
      vectorSize: 2,
    });

    expect(client.queries[0]?.text).toBe("CREATE EXTENSION IF NOT EXISTS vector");
    expect(client.queries[1]?.text).toContain('CREATE TABLE IF NOT EXISTS "docs"');
    expect(client.queries[1]?.text).toContain("embedding vector(2) NOT NULL");
    expect(client.queries[2]?.text).toContain("pg_attribute");
    expect(client.queries[2]?.values).toEqual(['"docs"']);
  });

  it("respects createIfMissing false", async () => {
    const client = new MockPgClient();

    await PgVectorStore.connect({
      client,
      tableName: "docs",
      vectorSize: 2,
      createIfMissing: false,
    });

    expect(client.queries).toHaveLength(1);
    expect(client.queries[0]?.text).toContain("pg_attribute");
  });

  it("upserts precomputed embeddings and queries with Anvia embeddings", async () => {
    const client = new MockPgClient();
    const model = new MockEmbeddingModel();
    const store = await PgVectorStore.connect<{ title: string }>({
      client,
      tableName: "docs",
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

    const insert = client.queries.find((query) => query.text.startsWith("INSERT INTO"));
    expect(insert?.text).toContain('INSERT INTO "docs"');
    expect(insert?.text).toContain("ON CONFLICT (id) DO UPDATE");
    expect(insert?.values?.slice(1)).toEqual([
      "doc1",
      JSON.stringify({ id: "doc1", title: "Cat guide" }),
      JSON.stringify({ kind: "animal" }),
      "[1,0]",
    ]);

    const search = client.queries.find((query) => query.text.includes("SELECT id, document_id"));
    expect(search?.text).toContain("embedding <=> $1::vector AS distance");
    expect(search?.text).toContain("WHERE (metadata ->> $2) = $3");
    expect(search?.text).toContain("LIMIT $4");
    expect(search?.values).toEqual(["[1,0]", "kind", "animal", 2]);
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
    const client = new MockPgClient();
    const store = await PgVectorStore.connect<string>({
      client,
      tableName: "docs",
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

    const insert = client.queries.find((query) => query.text.startsWith("INSERT INTO"));
    expect(insert?.values?.[0]).toMatch(
      /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/,
    );
    expect(insert?.values?.[5]).toMatch(
      /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/,
    );
    expect(insert?.values?.[0]).not.toBe(insert?.values?.[5]);
    expect(insert?.values?.[1]).toBe("doc1");
    expect(insert?.values?.[6]).toBe("doc1");
  });

  it("translates compound filters with parameterized metadata access", () => {
    expect(
      filterToPgVectorWhere(
        vectorFilter.and(vectorFilter.gt("rank", 2), vectorFilter.lt("rank", 5)),
        2,
      ),
    ).toEqual({
      sql: "((metadata ->> $2)::numeric > $3 AND (metadata ->> $4)::numeric < $5)",
      values: ["rank", 2, "rank", 5],
    });
    expect(
      filterToPgVectorWhere(
        vectorFilter.or(vectorFilter.eq("a", true), vectorFilter.eq("b", false)),
        2,
      ),
    ).toEqual({
      sql: "((metadata ->> $2) = $3 OR (metadata ->> $4) = $5)",
      values: ["a", "true", "b", "false"],
    });
  });

  it("supports l2 and inner product distance score conversion", async () => {
    const client = new MockPgClient();
    const model = new MockEmbeddingModel();
    const l2Store = await PgVectorStore.connect<string>({
      client,
      tableName: "docs",
      vectorSize: 2,
      distance: "l2",
    });

    const l2Results = await l2Store.index(model).search({ query: "cat", topK: 1 });
    expect(l2Results[0]?.score).toBe(-0.1);
    expect(client.queries.at(-1)?.text).toContain("embedding <-> $1::vector");

    const innerProductStore = await PgVectorStore.connect<string>({
      client,
      tableName: "docs",
      vectorSize: 2,
      distance: "innerProduct",
    });
    await innerProductStore.index(model).search({ query: "cat", topK: 1 });
    expect(client.queries.at(-1)?.text).toContain("embedding <#> $1::vector");
  });

  it("rejects documents with no embeddings", async () => {
    const client = new MockPgClient();
    const store = await PgVectorStore.connect<string>({
      client,
      tableName: "docs",
      vectorSize: 2,
    });

    await expect(
      store.upsertDocuments([{ id: "doc1", document: "empty", embeddings: [] }]),
    ).rejects.toThrow("Document doc1 has no embeddings");
  });

  it("rejects reserved metadata keys", async () => {
    const client = new MockPgClient();
    const store = await PgVectorStore.connect<string>({
      client,
      tableName: "docs",
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

  it("fails when table vector dimensions do not match", async () => {
    const client = new MockPgClient();
    client.query = async (text: string, values?: readonly unknown[]) => {
      client.queries.push({ text, values });
      if (text.includes("pg_attribute")) {
        return { rows: [{ vector_size: 3 }] };
      }
      return { rows: [] };
    };

    await expect(
      PgVectorStore.connect({
        client,
        tableName: "docs",
        vectorSize: 2,
      }),
    ).rejects.toThrow('PgVector table "docs" has vector size 3; expected 2');
  });
});
