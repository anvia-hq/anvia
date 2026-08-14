import { type Embedding, type EmbeddingModel, embedDocuments } from "@anvia/core/embeddings";
import { vectorFilter } from "@anvia/core/vector-store";
import { describe, expect, it } from "vitest";
import { filterToLanceExpr, LanceDBVectorStore } from "../src/index";
import type { LanceDBConnectionLike, LanceDBTableLike } from "../src/types";

class MockEmbeddingModel implements EmbeddingModel {
  async embedTexts(texts: string[]): Promise<Embedding[]> {
    return texts.map((document) => ({
      document,
      vector: document.toLowerCase().includes("cat") ? [1, 0] : [0, 1],
    }));
  }
}

class MockLanceDBTable implements LanceDBTableLike {
  readonly addedRows: Record<string, unknown>[][] = [];

  async add(rows: Record<string, unknown>[]): Promise<unknown> {
    this.addedRows.push(rows);
    return {};
  }

  search(_vector: number[]) {
    return {
      limit: (_n: number) => ({
        filter: async (_expr: string | undefined) => this.mockResults(),
        toArray: async () => this.mockResults(),
      }),
    };
  }

  async countRows(): Promise<number> {
    return this.addedRows.reduce((sum, batch) => sum + batch.length, 0);
  }

  async delete(_filter: string): Promise<unknown> {
    return {};
  }

  private mockResults(): unknown[] {
    return [
      {
        __anvia_document_id: "doc1",
        __anvia_document: JSON.stringify({ title: "Cat guide" }),
        __anvia_vector: [1, 0],
        kind: "animal",
        _distance: 0.1,
      },
      {
        __anvia_document_id: "doc2",
        __anvia_document: "plain dog note",
        __anvia_vector: [0, 1],
        _distance: 0.6,
      },
    ];
  }
}

class MockLanceDBConnection implements LanceDBConnectionLike {
  readonly tables = new Map<string, MockLanceDBTable>();
  readonly createdTables: string[] = [];

  async openTable(name: string): Promise<MockLanceDBTable> {
    const table = this.tables.get(name);
    if (!table) {
      throw new Error(`Table ${name} not found`);
    }
    return table;
  }

  async tableNames(): Promise<string[]> {
    return [...this.tables.keys()];
  }

  async createTable(name: string, _data: Record<string, unknown>[]): Promise<MockLanceDBTable> {
    const table = new MockLanceDBTable();
    this.tables.set(name, table);
    this.createdTables.push(name);
    return table;
  }
}

describe("LanceDBVectorStore", () => {
  it("creates a missing table", async () => {
    const connection = new MockLanceDBConnection();

    await LanceDBVectorStore.connect({
      client: connection,
      tableName: "docs",
      vectorSize: 2,
    });

    expect(connection.createdTables).toEqual(["docs"]);
  });

  it("respects createIfMissing false and throws if table missing", async () => {
    const connection = new MockLanceDBConnection();

    await expect(
      LanceDBVectorStore.connect({
        client: connection,
        tableName: "docs",
        vectorSize: 2,
        createIfMissing: false,
      }),
    ).rejects.toThrow("Table docs not found");
  });

  it("respects createIfMissing false and succeeds if table exists", async () => {
    const connection = new MockLanceDBConnection();
    connection.tables.set("docs", new MockLanceDBTable());

    await LanceDBVectorStore.connect({
      client: connection,
      tableName: "docs",
      vectorSize: 2,
      createIfMissing: false,
    });

    expect(connection.createdTables).toEqual([]);
  });

  it("upserts precomputed embeddings and queries with Anvia embeddings", async () => {
    const connection = new MockLanceDBConnection();
    const model = new MockEmbeddingModel();
    const store = await LanceDBVectorStore.connect<{ title: string }>({
      client: connection,
      tableName: "docs",
      vectorSize: 2,
    });
    const embedded = await embedDocuments(model, [{ id: "doc1", title: "Cat guide" }], {
      id: (doc: { id: string; title: string }) => doc.id,
      content: (doc: { id: string; title: string }) => doc.title,
      metadata: () => ({ kind: "animal" }),
    });

    await store.upsertDocuments(embedded);
    const table = await connection.openTable("docs");
    expect(table.addedRows[0]).toMatchObject([
      {
        __anvia_document_id: "doc1",
        __anvia_document: JSON.stringify({ id: "doc1", title: "Cat guide" }),
        __anvia_vector: [1, 0],
        kind: "animal",
      },
    ]);

    const results = await store.index(model).search({
      query: "cat",
      topK: 2,
      threshold: 0.5,
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
    const connection = new MockLanceDBConnection();
    const store = await LanceDBVectorStore.connect<string>({
      client: connection,
      tableName: "docs",
      vectorSize: 2,
    });

    await expect(
      store.upsertDocuments([{ id: "doc1", document: "empty", embeddings: [] }]),
    ).rejects.toThrow("Document doc1 has no embeddings");
  });

  it("rejects reserved metadata keys", async () => {
    const connection = new MockLanceDBConnection();
    const store = await LanceDBVectorStore.connect<string>({
      client: connection,
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
});

describe("filterToLanceExpr", () => {
  it("returns undefined for undefined filter", () => {
    expect(filterToLanceExpr(undefined)).toBeUndefined();
  });

  it("translates eq filter", () => {
    expect(filterToLanceExpr(vectorFilter.eq("kind", "animal"))).toBe("kind = 'animal'");
    expect(filterToLanceExpr(vectorFilter.eq("count", 5))).toBe("count = 5");
    expect(filterToLanceExpr(vectorFilter.eq("active", true))).toBe("active = TRUE");
    expect(filterToLanceExpr(vectorFilter.eq("tag", null))).toBe("tag IS NULL");
  });

  it("translates gt and lt filters", () => {
    expect(filterToLanceExpr(vectorFilter.gt("rank", 2))).toBe("rank > 2");
    expect(filterToLanceExpr(vectorFilter.lt("rank", 5))).toBe("rank < 5");
  });

  it("translates compound filters", () => {
    expect(
      filterToLanceExpr(vectorFilter.and(vectorFilter.gt("rank", 2), vectorFilter.lt("rank", 5))),
    ).toBe("(rank > 2) AND (rank < 5)");
    expect(
      filterToLanceExpr(vectorFilter.or(vectorFilter.eq("a", "x"), vectorFilter.eq("b", "y"))),
    ).toBe("(a = 'x') OR (b = 'y')");
  });

  it("escapes single quotes in string values", () => {
    expect(filterToLanceExpr(vectorFilter.eq("name", "it's"))).toBe("name = 'it''s'");
  });

  describe("SQL injection protection", () => {
    it("rejects malicious column names with SQL injection attempts", () => {
      expect(() =>
        filterToLanceExpr(vectorFilter.eq("name'; DROP TABLE users; --", "value")),
      ).toThrow("Invalid column name");
      expect(() => filterToLanceExpr(vectorFilter.eq("name; DELETE FROM users", "value"))).toThrow(
        "Invalid column name",
      );
      expect(() => filterToLanceExpr(vectorFilter.eq("name OR 1=1", "value"))).toThrow(
        "Invalid column name",
      );
    });

    it("rejects column names with special SQL characters", () => {
      expect(() => filterToLanceExpr(vectorFilter.eq("name'", "value"))).toThrow(
        "Invalid column name",
      );
      expect(() => filterToLanceExpr(vectorFilter.eq("name;", "value"))).toThrow(
        "Invalid column name",
      );
      expect(() => filterToLanceExpr(vectorFilter.eq("name--", "value"))).toThrow(
        "Invalid column name",
      );
      expect(() => filterToLanceExpr(vectorFilter.eq("name/**/", "value"))).toThrow(
        "Invalid column name",
      );
    });

    it("rejects column names that are SQL keywords", () => {
      expect(() => filterToLanceExpr(vectorFilter.eq("SELECT", "value"))).toThrow(
        "Column name segment",
      );
      expect(() => filterToLanceExpr(vectorFilter.eq("DROP", "value"))).toThrow(
        "Column name segment",
      );
      expect(() => filterToLanceExpr(vectorFilter.eq("DELETE", "value"))).toThrow(
        "Column name segment",
      );
    });

    it("rejects SQL keywords in nested field segments", () => {
      expect(() => filterToLanceExpr(vectorFilter.eq("metadata.SELECT", "value"))).toThrow(
        "Column name segment",
      );
      expect(() => filterToLanceExpr(vectorFilter.eq("user.DROP", "value"))).toThrow(
        "Column name segment",
      );
      expect(() => filterToLanceExpr(vectorFilter.eq("data.DELETE.field", "value"))).toThrow(
        "Column name segment",
      );
    });

    it("rejects column names starting with numbers", () => {
      expect(() => filterToLanceExpr(vectorFilter.eq("123column", "value"))).toThrow(
        "Invalid column name",
      );
    });

    it("rejects non-finite numeric values in gt/lt filters", () => {
      expect(() => filterToLanceExpr(vectorFilter.gt("rank", NaN))).toThrow(
        "Value must be a finite number",
      );
      expect(() => filterToLanceExpr(vectorFilter.gt("rank", Infinity))).toThrow(
        "Value must be a finite number",
      );
      expect(() => filterToLanceExpr(vectorFilter.lt("rank", -Infinity))).toThrow(
        "Value must be a finite number",
      );
    });

    it("rejects non-numeric values in gt/lt filters", () => {
      expect(() =>
        filterToLanceExpr(vectorFilter.gt("rank", "2; DROP TABLE" as unknown as number)),
      ).toThrow("Expected a number");
    });

    it("allows valid column names with underscores", () => {
      expect(filterToLanceExpr(vectorFilter.eq("user_name", "alice"))).toBe("user_name = 'alice'");
      expect(filterToLanceExpr(vectorFilter.eq("_private_field", "value"))).toBe(
        "_private_field = 'value'",
      );
    });

    it("allows valid column names with dots for nested fields", () => {
      expect(filterToLanceExpr(vectorFilter.eq("user.name", "alice"))).toBe("user.name = 'alice'");
      expect(filterToLanceExpr(vectorFilter.eq("metadata.tags.category", "tech"))).toBe(
        "metadata.tags.category = 'tech'",
      );
    });

    it("allows valid numeric values", () => {
      expect(filterToLanceExpr(vectorFilter.gt("rank", 0))).toBe("rank > 0");
      expect(filterToLanceExpr(vectorFilter.gt("rank", -100))).toBe("rank > -100");
      expect(filterToLanceExpr(vectorFilter.lt("rank", 999.99))).toBe("rank < 999.99");
    });

    it("protects against SQL injection in compound filters", () => {
      expect(() =>
        filterToLanceExpr(
          vectorFilter.and(
            vectorFilter.eq("name'; DROP TABLE users; --", "value"),
            vectorFilter.eq("status", "active"),
          ),
        ),
      ).toThrow("Invalid column name");
    });
  });
});
