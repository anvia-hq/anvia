import { describe, expect, it, vi } from "vitest";
import * as publicApi from "../src/index.js";
import {
  type ChromaClientLike,
  type ChromaCollectionLike,
  ChromaVectorClient,
} from "../src/index.js";

function fixture() {
  const collection: ChromaCollectionLike = {
    delete: vi.fn(async () => undefined),
    upsert: vi.fn(async () => undefined),
    query: vi.fn(async () => ({
      ids: [["doc"]],
      documents: [[JSON.stringify({ text: "cat" })]],
      metadatas: [[{ source: "test", __anvia_document_id: "doc" }]],
      distances: [[0.1]],
    })),
  };
  const client: ChromaClientLike = {
    getCollection: vi.fn(async () => collection),
    createCollection: vi.fn(async () => collection),
    getOrCreateCollection: vi.fn(async () => collection),
  };
  return { client, collection };
}

describe("ChromaVectorClient", () => {
  it("exports the client without legacy index or connect APIs", () => {
    expect(publicApi).toHaveProperty("ChromaVectorClient");
    expect(publicApi).not.toHaveProperty("ChromaVectorIndex");
    expect(publicApi.ChromaVectorStore).not.toHaveProperty("connect");
    expect(publicApi.ChromaVectorStore.prototype).not.toHaveProperty("index");
    expect(publicApi.ChromaVectorStore.prototype).not.toHaveProperty("asTool");
  });
  it("constructs side-effect-free handles and provisions explicitly", async () => {
    const { client } = fixture();
    const owner = new ChromaVectorClient({ client });
    const store = owner.vectorStore<{ text: string }>({ collectionName: "docs", dimensions: 2 });
    expect(client.getOrCreateCollection).not.toHaveBeenCalled();
    await store.ensure();
    expect(client.getOrCreateCollection).toHaveBeenCalledOnce();
  });

  it("replaces documents and searches with raw vectors", async () => {
    const { client, collection } = fixture();
    const store = new ChromaVectorClient({ client }).vectorStore<{ text: string }>({
      collectionName: "docs",
      dimensions: 2,
    });
    await store.upsert({
      documents: [
        { id: "doc", document: { text: "cat" }, embeddings: [{ document: "cat", vector: [1, 0] }] },
      ],
    });
    expect(collection.delete).toHaveBeenCalledBefore(collection.upsert as never);
    await expect(store.search({ vector: [1, 0], topK: 1 })).resolves.toMatchObject([
      { id: "doc", score: 0.9, metadata: { source: "test" } },
    ]);
    expect(collection.query).toHaveBeenCalledWith(
      expect.objectContaining({ queryEmbeddings: [[1, 0]] }),
    );
  });

  it("expands physical candidates until topK logical documents are available", async () => {
    const query = vi.fn(async (options: Record<string, unknown>) => {
      const candidates = [
        {
          id: "a#embedding:0",
          document: "A",
          metadata: { __anvia_document_id: "a" },
          distance: 0.1,
        },
        {
          id: "a#embedding:1",
          document: "A",
          metadata: { __anvia_document_id: "a" },
          distance: 0.2,
        },
        { id: "b", document: "B", metadata: { __anvia_document_id: "b" }, distance: 0.3 },
        { id: "c", document: "C", metadata: { __anvia_document_id: "c" }, distance: 0.4 },
      ].slice(0, Number(options.nResults));
      return {
        ids: [candidates.map((candidate) => candidate.id)],
        documents: [candidates.map((candidate) => candidate.document)],
        metadatas: [candidates.map((candidate) => candidate.metadata)],
        distances: [candidates.map((candidate) => candidate.distance)],
      };
    });
    const collection: ChromaCollectionLike = {
      delete: vi.fn(async () => undefined),
      upsert: vi.fn(async () => undefined),
      query,
    };
    const client: ChromaClientLike = {
      getCollection: vi.fn(async () => collection),
      createCollection: vi.fn(async () => collection),
    };
    const store = new ChromaVectorClient({ client }).vectorStore<string>({
      collectionName: "docs",
      dimensions: 2,
    });

    await expect(store.search({ vector: [1, 0], topK: 2 })).resolves.toMatchObject([
      { id: "a" },
      { id: "b" },
    ]);
    expect(query.mock.calls.map(([options]) => options.nResults)).toEqual([2, 4]);
  });
});
