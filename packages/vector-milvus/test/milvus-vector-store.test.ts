import { describe, expect, it, vi } from "vitest";
import * as publicApi from "../src/index.js";
import { type MilvusClientLike, MilvusVectorClient } from "../src/index.js";

function fixture(): MilvusClientLike {
  return {
    hasCollection: vi.fn(async () => ({ value: true })),
    createCollection: vi.fn(async () => undefined),
    createIndex: vi.fn(async () => undefined),
    loadCollection: vi.fn(async () => undefined),
    insert: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    search: vi.fn(async () => ({
      results: [
        {
          id: "point",
          score: 0.9,
          __anvia_document_id: "doc",
          __anvia_document: JSON.stringify({ text: "cat" }),
        },
      ],
    })),
  };
}

describe("MilvusVectorClient", () => {
  it("exports the client without legacy index or connect APIs", () => {
    expect(publicApi).toHaveProperty("MilvusVectorClient");
    expect(publicApi).not.toHaveProperty("MilvusVectorIndex");
    expect(publicApi.MilvusVectorStore).not.toHaveProperty("connect");
    expect(publicApi.MilvusVectorStore.prototype).not.toHaveProperty("index");
    expect(publicApi.MilvusVectorStore.prototype).not.toHaveProperty("asTool");
  });
  it("does no I/O until lifecycle or data operations", async () => {
    const client = fixture();
    const store = new MilvusVectorClient({ client }).vectorStore({
      collectionName: "docs",
      dimensions: 2,
    });
    expect(client.hasCollection).not.toHaveBeenCalled();
    await store.validate();
    expect(client.hasCollection).toHaveBeenCalledOnce();
  });
  it("replaces and searches with raw vectors", async () => {
    const client = fixture();
    const store = new MilvusVectorClient({ client }).vectorStore<{ text: string }>({
      collectionName: "docs",
      dimensions: 2,
    });
    await store.upsert({
      documents: [
        { id: "doc", document: { text: "cat" }, embeddings: [{ document: "cat", vector: [1, 0] }] },
      ],
    });
    expect(client.delete).toHaveBeenCalledBefore(client.insert as never);
    expect(client.delete).toHaveBeenCalledWith(
      expect.objectContaining({ filter: expect.stringContaining("__anvia_document_id") }),
    );
    expect(client.delete).not.toHaveBeenCalledWith(
      expect.objectContaining({ expr: expect.anything() }),
    );
    await expect(store.search({ vector: [1, 0], topK: 1 })).resolves.toMatchObject([
      { id: "doc", score: 0.9 },
    ]);
    expect(client.search).toHaveBeenCalledWith(expect.objectContaining({ data: [[1, 0]] }));
  });

  it("expands physical candidates until topK logical documents are available", async () => {
    const client = fixture();
    client.search = vi.fn(async (options) => {
      const results = [
        {
          id: "a-1",
          score: 0.9,
          __anvia_document_id: "a",
          __anvia_document: "A",
        },
        {
          id: "a-2",
          score: 0.8,
          __anvia_document_id: "a",
          __anvia_document: "A",
        },
      ];
      if (options.limit !== 2) {
        results.push(
          {
            id: "b",
            score: 0.7,
            __anvia_document_id: "b",
            __anvia_document: "B",
          },
          {
            id: "c",
            score: 0.6,
            __anvia_document_id: "c",
            __anvia_document: "C",
          },
        );
      }
      return { results };
    });
    const store = new MilvusVectorClient({ client }).vectorStore<string>({
      collectionName: "docs",
      dimensions: 2,
    });

    await expect(store.search({ vector: [1, 0], topK: 2 })).resolves.toMatchObject([
      { id: "a" },
      { id: "b" },
    ]);
    expect(
      (client.search as ReturnType<typeof vi.fn>).mock.calls.map(([call]) => call.limit),
    ).toEqual([2, 4]);
  });
});
