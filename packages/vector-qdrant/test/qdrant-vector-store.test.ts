import { describe, expect, it, vi } from "vitest";
import * as publicApi from "../src/index.js";
import { type QdrantClientLike, QdrantVectorClient } from "../src/index.js";

function collectionInfo(hybrid = false) {
  return {
    result: {
      config: {
        params: hybrid
          ? { vectors: { dense: { size: 2, distance: "Cosine" } }, sparse_vectors: { sparse: {} } }
          : { vectors: { size: 2, distance: "Cosine" } },
      },
    },
  };
}

function fixture(hybrid = false): QdrantClientLike {
  return {
    getCollection: vi.fn(async () => collectionInfo(hybrid)),
    createCollection: vi.fn(async () => undefined),
    collectionExists: vi.fn(async () => ({ exists: true })),
    upsert: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    batchUpdate: vi.fn(async () => undefined),
    query: vi.fn(async () => ({
      result: {
        points: [
          {
            id: "point",
            score: 0.9,
            payload: {
              __anvia_document_id: "doc",
              __anvia_document: JSON.stringify({ text: "cat" }),
              source: "test",
            },
          },
        ],
      },
    })),
    scroll: vi.fn(async () => ({ result: { points: [], next_page_offset: null } })),
  };
}

describe("QdrantVectorClient", () => {
  it("exports dense and hybrid stores without legacy index or connect APIs", () => {
    expect(publicApi).toHaveProperty("QdrantVectorClient");
    expect(publicApi).not.toHaveProperty("QdrantVectorIndex");
    expect(publicApi.QdrantVectorStore).not.toHaveProperty("connect");
    expect(publicApi.QdrantVectorStore.prototype).not.toHaveProperty("index");
    expect(publicApi.QdrantVectorStore.prototype).not.toHaveProperty("asTool");
    expect(publicApi).toHaveProperty("QdrantHybridVectorStore");
  });
  it("creates side-effect-free handles and validates explicitly", async () => {
    const client = fixture();
    const store = new QdrantVectorClient({ client }).vectorStore({
      collectionName: "docs",
      dimensions: 2,
    });
    expect(client.getCollection).not.toHaveBeenCalled();
    await store.validate();
    expect(client.getCollection).toHaveBeenCalledOnce();
    expect("searchHybrid" in store).toBe(false);
  });

  it("replaces documents and searches with raw dense vectors", async () => {
    const client = fixture();
    const store = new QdrantVectorClient({ client }).vectorStore<{ text: string }>({
      collectionName: "docs",
      dimensions: 2,
    });
    await store.upsert({
      documents: [
        {
          id: "doc",
          document: { text: "cat" },
          embeddings: [{ document: "cat", vector: [1, 0] }],
        },
      ],
      providerOptions: { wait: true },
    });
    expect(client.batchUpdate).toHaveBeenCalledWith(
      "docs",
      expect.objectContaining({ operations: expect.any(Array) }),
    );
    await expect(store.search({ vector: [1, 0], topK: 1 })).resolves.toMatchObject([
      { id: "doc", score: 0.9, metadata: { source: "test" } },
    ]);
  });

  it("isolates tenant handles within a shared collection", async () => {
    const client = fixture();
    const owner = new QdrantVectorClient({ client });
    const tenantA = owner.tenant("user-a");
    const tenantB = owner.tenant("user-b");
    const storeA = tenantA.vectorStore<string>({ collectionName: "docs", dimensions: 2 });
    const storeB = tenantB.vectorStore<string>({ collectionName: "docs", dimensions: 2 });

    expect(tenantA.namespace).toMatch(/^[a-f0-9]{64}$/);
    expect(tenantA.namespace).toBe(
      "fc95297aa4f56781f0decb7d4bf59b1447f09b3611039b80188b1c6beb03ee6a",
    );
    expect(tenantB.namespace).not.toBe(tenantA.namespace);
    expect(owner.tenant("user-a").namespace).toBe(tenantA.namespace);

    await storeA.upsert({
      documents: [{ id: "doc", document: "A", embeddings: [{ document: "A", vector: [1, 0] }] }],
    });
    await storeB.upsert({
      documents: [{ id: "doc", document: "B", embeddings: [{ document: "B", vector: [1, 0] }] }],
    });

    const operations = (client.batchUpdate as ReturnType<typeof vi.fn>).mock.calls.map(
      ([, request]) => request.operations,
    );
    expect(operations[0][0].delete.filter).toEqual({
      must: [
        { key: "__anvia_document_id", match: { any: ["doc"] } },
        { key: "__anvia_namespace", match: { value: tenantA.namespace } },
      ],
    });
    expect(operations[0][1].upsert.points[0].payload.__anvia_namespace).toBe(tenantA.namespace);
    expect(operations[1][1].upsert.points[0].payload.__anvia_namespace).toBe(tenantB.namespace);
    expect(operations[0][1].upsert.points[0].id).not.toBe(operations[1][1].upsert.points[0].id);

    await storeA.search({
      vector: [1, 0],
      topK: 1,
      filter: { type: "eq", key: "source", value: "test" },
    });
    expect(client.query).toHaveBeenLastCalledWith(
      "docs",
      expect.objectContaining({
        filter: {
          must: [
            { key: "__anvia_namespace", match: { value: tenantA.namespace } },
            { must: [{ key: "source", match: { value: "test" } }] },
          ],
        },
      }),
    );

    await storeA.delete({ documentIds: ["doc"] });
    expect(client.delete).toHaveBeenLastCalledWith(
      "docs",
      expect.objectContaining({
        filter: {
          must: [
            { key: "__anvia_document_id", match: { any: ["doc"] } },
            { key: "__anvia_namespace", match: { value: tenantA.namespace } },
          ],
        },
      }),
    );

    await storeA.inspect({ limit: 10 });
    expect(client.scroll).toHaveBeenLastCalledWith(
      "docs",
      expect.objectContaining({
        filter: {
          must: [{ key: "__anvia_namespace", match: { value: tenantA.namespace } }],
        },
      }),
    );

    await storeA.get({ documentIds: ["doc"] });
    expect(client.scroll).toHaveBeenLastCalledWith(
      "docs",
      expect.objectContaining({
        filter: {
          must: [
            { key: "__anvia_document_id", match: { any: ["doc"] } },
            { key: "__anvia_namespace", match: { value: tenantA.namespace } },
          ],
        },
      }),
    );
  });

  it("rejects empty tenant identifiers", () => {
    const owner = new QdrantVectorClient({ client: fixture() });
    expect(() => owner.tenant("  ")).toThrow("tenant id must be a non-empty string");
  });

  it("keeps hybrid search an explicit capability", async () => {
    const client = fixture(true);
    const owner = new QdrantVectorClient({ client });
    const tenant = owner.tenant("user-a");
    const store = tenant.vectorStore({
      collectionName: "docs",
      dimensions: 2,
      mode: "hybrid",
    });
    await store.validate();
    await store.searchHybrid({
      vector: [1, 0],
      sparseVector: { indices: [1], values: [2] },
      fusion: "rrf",
      topK: 2,
    });
    const request = (client.query as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[1];
    expect(request).toMatchObject({ prefetch: expect.any(Array), query: { fusion: "rrf" } });
    expect(
      request.prefetch.every(
        (prefetch: { filter: unknown }) =>
          JSON.stringify(prefetch.filter) ===
          JSON.stringify({
            must: [{ key: "__anvia_namespace", match: { value: tenant.namespace } }],
          }),
      ),
    ).toBe(true);
  });

  it("normalizes Euclidean distance and translates minScore for Qdrant", async () => {
    const client = fixture();
    client.query = vi.fn(async () => ({
      result: {
        points: [
          {
            id: "near",
            score: 0.2,
            payload: { __anvia_document_id: "near", __anvia_document: "near" },
          },
        ],
      },
    }));
    const store = new QdrantVectorClient({ client }).vectorStore<string>({
      collectionName: "docs",
      dimensions: 2,
      metric: "euclidean",
    });

    await expect(store.search({ vector: [1, 0], topK: 1, minScore: -0.5 })).resolves.toEqual([
      { id: "near", document: "near", score: -0.2 },
    ]);
    expect(client.query).toHaveBeenCalledWith(
      "docs",
      expect.objectContaining({ score_threshold: 0.5 }),
    );
  });

  it("expands physical candidates until topK logical documents are available", async () => {
    const client = fixture();
    client.query = vi.fn(async (_collection, options) => {
      const points = [
        {
          id: "a-1",
          score: 0.9,
          payload: { __anvia_document_id: "a", __anvia_document: "A" },
        },
        {
          id: "a-2",
          score: 0.8,
          payload: { __anvia_document_id: "a", __anvia_document: "A" },
        },
      ];
      if (options.limit !== 2) {
        points.push(
          {
            id: "b",
            score: 0.7,
            payload: { __anvia_document_id: "b", __anvia_document: "B" },
          },
          {
            id: "c",
            score: 0.6,
            payload: { __anvia_document_id: "c", __anvia_document: "C" },
          },
        );
      }
      return { result: { points } };
    });
    const store = new QdrantVectorClient({ client }).vectorStore<string>({
      collectionName: "docs",
      dimensions: 2,
    });

    await expect(store.search({ vector: [1, 0], topK: 2 })).resolves.toMatchObject([
      { id: "a" },
      { id: "b" },
    ]);
    expect(
      (client.query as ReturnType<typeof vi.fn>).mock.calls.map(([, call]) => call.limit),
    ).toEqual([2, 4]);
  });

  it("does not close an injected native client but rejects reuse", async () => {
    const owner = new QdrantVectorClient({ client: fixture() });
    await owner.close();
    expect(() => owner.nativeClient()).toThrow("closed");
  });
});
