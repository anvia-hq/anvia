import { describe, expect, it, vi } from "vitest";
import * as publicApi from "../src/index.js";
import { type WeaviateClientLike, WeaviateVectorClient } from "../src/index.js";

const connectToCustom = vi.hoisted(() =>
  vi.fn(async () => ({
    collections: {
      exists: vi.fn(async () => true),
      create: vi.fn(async () => undefined),
      get: vi.fn(),
    },
  })),
);

vi.mock("weaviate-client", () => ({ default: { connectToCustom } }));

describe("WeaviateVectorClient", () => {
  it("exports the client without legacy index or connect APIs", () => {
    expect(publicApi).toHaveProperty("WeaviateVectorClient");
    expect(publicApi).not.toHaveProperty("WeaviateVectorIndex");
    expect(publicApi.WeaviateVectorStore).not.toHaveProperty("connect");
    expect(publicApi.WeaviateVectorStore.prototype).not.toHaveProperty("index");
    expect(publicApi.WeaviateVectorStore.prototype).not.toHaveProperty("asTool");
  });
  it("uses explicit lifecycle, replacement, and raw-vector search", async () => {
    const deleteMany = vi.fn(async () => undefined);
    const insertMany = vi.fn(async () => undefined);
    const nearVector = vi.fn(async () => ({
      objects: [
        {
          uuid: "point",
          properties: {
            __anvia_document_id: "doc",
            __anvia_document: JSON.stringify({ text: "cat" }),
          },
          metadata: { certainty: 0.55, distance: 0.1 },
        },
      ],
    }));
    const collection = { query: { nearVector }, data: { deleteMany, insertMany } };
    const client: WeaviateClientLike = {
      collections: {
        exists: vi.fn(async () => true),
        create: vi.fn(async () => undefined),
        get: vi.fn(() => collection),
      },
    };
    const store = new WeaviateVectorClient({ client }).vectorStore<{ text: string }>({
      collectionName: "Docs",
      dimensions: 2,
    });
    expect(client.collections.exists).not.toHaveBeenCalled();
    await store.validate();
    await store.upsert({
      documents: [
        { id: "doc", document: { text: "cat" }, embeddings: [{ document: "cat", vector: [1, 0] }] },
      ],
    });
    expect(deleteMany).toHaveBeenCalled();
    expect(insertMany).toHaveBeenCalled();
    await expect(store.search({ vector: [1, 0], topK: 1 })).resolves.toMatchObject([
      { id: "doc", score: 0.9 },
    ]);
    expect(nearVector).toHaveBeenCalledWith(
      [1, 0],
      expect.objectContaining({ limit: 1, returnMetadata: ["distance"] }),
      { abortSignal: undefined },
    );
  });

  it("passes provider-accurate hosts and ports to the native client", async () => {
    const owner = new WeaviateVectorClient({
      httpHost: "weaviate.internal",
      httpPort: 8088,
      grpcHost: "weaviate-grpc.internal",
      grpcPort: 50061,
    });

    await owner.nativeClient();

    expect(connectToCustom).toHaveBeenCalledWith(
      expect.objectContaining({
        httpHost: "weaviate.internal",
        httpPort: 8088,
        grpcHost: "weaviate-grpc.internal",
        grpcPort: 50061,
      }),
    );
  });

  it("rejects partial delete and insert failures", async () => {
    const documents = [
      { id: "doc", document: "doc", embeddings: [{ document: "doc", vector: [1, 0] }] },
    ];
    const failedDelete = vi.fn(async () => ({ failed: 1, successful: 0, matches: 1 }));
    const skippedInsert = vi.fn(async () => ({ hasErrors: false, errors: {} }));
    const deleteClient: WeaviateClientLike = {
      collections: {
        exists: vi.fn(async () => true),
        create: vi.fn(async () => undefined),
        get: vi.fn(() => ({
          query: { nearVector: vi.fn(async () => ({ objects: [] })) },
          data: { deleteMany: failedDelete, insertMany: skippedInsert },
        })),
      },
    };
    const deleteStore = new WeaviateVectorClient({ client: deleteClient }).vectorStore({
      collectionName: "Docs",
      dimensions: 2,
    });
    await expect(deleteStore.upsert({ documents })).rejects.toThrow("failed to delete");
    expect(skippedInsert).not.toHaveBeenCalled();

    const insertClient: WeaviateClientLike = {
      collections: {
        exists: vi.fn(async () => true),
        create: vi.fn(async () => undefined),
        get: vi.fn(() => ({
          query: { nearVector: vi.fn(async () => ({ objects: [] })) },
          data: {
            deleteMany: vi.fn(async () => ({ failed: 0, successful: 1, matches: 1 })),
            insertMany: vi.fn(async () => ({ hasErrors: true, errors: { 0: new Error("bad") } })),
          },
        })),
      },
    };
    const insertStore = new WeaviateVectorClient({ client: insertClient }).vectorStore({
      collectionName: "Docs",
      dimensions: 2,
    });
    await expect(insertStore.upsert({ documents })).rejects.toThrow("failed to insert");
  });

  it("normalizes non-cosine distance without using certainty", async () => {
    const nearVector = vi.fn(async () => ({
      objects: [
        {
          uuid: "point",
          properties: { __anvia_document_id: "doc", __anvia_document: "doc" },
          metadata: { certainty: 0.99, distance: 0.25 },
        },
      ],
    }));
    const client: WeaviateClientLike = {
      collections: {
        exists: vi.fn(async () => true),
        create: vi.fn(async () => undefined),
        get: vi.fn(() => ({ query: { nearVector } })),
      },
    };
    const store = new WeaviateVectorClient({ client }).vectorStore<string>({
      collectionName: "Docs",
      dimensions: 2,
      metric: "euclidean",
    });

    await expect(store.search({ vector: [1, 0], topK: 1 })).resolves.toEqual([
      { id: "doc", document: "doc", score: -0.25 },
    ]);
  });

  it("expands physical candidates until topK logical documents are available", async () => {
    const nearVector = vi.fn(async (_vector: number[], options?: { limit?: number }) => {
      const candidates = [
        {
          uuid: "a-1",
          properties: { __anvia_document_id: "a", __anvia_document: "A" },
          metadata: { distance: 0.1 },
        },
        {
          uuid: "a-2",
          properties: { __anvia_document_id: "a", __anvia_document: "A" },
          metadata: { distance: 0.2 },
        },
        {
          uuid: "b",
          properties: { __anvia_document_id: "b", __anvia_document: "B" },
          metadata: { distance: 0.3 },
        },
        {
          uuid: "c",
          properties: { __anvia_document_id: "c", __anvia_document: "C" },
          metadata: { distance: 0.4 },
        },
      ];
      return { objects: candidates.slice(0, options?.limit) };
    });
    const client: WeaviateClientLike = {
      collections: {
        exists: vi.fn(async () => true),
        create: vi.fn(async () => undefined),
        get: vi.fn(() => ({ query: { nearVector } })),
      },
    };
    const store = new WeaviateVectorClient({ client }).vectorStore<string>({
      collectionName: "Docs",
      dimensions: 2,
    });

    await expect(store.search({ vector: [1, 0], topK: 2 })).resolves.toMatchObject([
      { id: "a" },
      { id: "b" },
    ]);
    expect(nearVector.mock.calls.map(([, options]) => options?.limit)).toEqual([2, 4]);
  });
});
