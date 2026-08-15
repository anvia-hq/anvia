import { describe, expect, it, vi } from "vitest";
import {
  createVectorContext,
  createVectorSearchTool,
  type EmbeddingModel,
  embedDocuments,
  embedSparseQuery,
  embedSparseTexts,
  embedText,
  embedTexts,
  type HybridVectorSearchRequest,
  type HybridVectorStore,
  InMemoryVectorStore,
  isVectorContext,
  retrieveDocuments,
  type SparseEmbeddingModel,
  type VectorSearchRequest,
  type VectorStoreUpsertOptions,
} from "./helpers/imports";

class KeywordModel implements EmbeddingModel {
  readonly dimensions = 2;
  readonly maxBatchSize = 2;
  readonly calls: string[][] = [];
  async embedTexts(texts: string[]) {
    this.calls.push(texts);
    return texts.map((document) => ({
      document,
      vector: [document.toLowerCase().includes("cat") ? 1 : 0, 1],
    }));
  }
}

class SparseModel implements SparseEmbeddingModel {
  async embedTexts(texts: string[]) {
    return texts.map((document) => ({ document, vector: { indices: [0], values: [1] } }));
  }
  async embedQuery(query: string) {
    return { document: query, vector: { indices: [1], values: [2] } };
  }
}

describe("embedding helpers", () => {
  it("accepts object arguments and returns named results", async () => {
    const model = new KeywordModel();
    const { embedding } = await embedText({ model, text: "cat" });
    const { embeddings } = await embedTexts({ model, texts: ["cat", "dog", "cat two"] });
    expect(embedding.vector).toEqual([1, 1]);
    expect(embeddings).toHaveLength(3);
    expect(model.calls).toEqual([["cat"], ["cat", "dog"], ["cat two"]]);
  });

  it("embeds dense documents and rejects duplicate ids", async () => {
    const model = new KeywordModel();
    const { documents } = await embedDocuments({
      model,
      documents: [
        { id: "a", text: "cat" },
        { id: "b", text: "dog" },
      ],
      id: (document) => document.id,
      content: (document) => document.text,
      metadata: (document) => ({ source: document.id }),
    });
    expect(documents[0]).toMatchObject({ id: "a", metadata: { source: "a" } });
    await expect(
      embedDocuments({
        model,
        documents: [{ id: "a" }, { id: "a" }],
        id: (document) => document.id,
        content: (document) => document.id,
      }),
    ).rejects.toThrow("Duplicate embedded document id: a");
  });

  it("embeds aligned dense and sparse documents through one helper", async () => {
    const { documents } = await embedDocuments({
      models: { dense: new KeywordModel(), sparse: new SparseModel() },
      documents: [{ id: "a", texts: ["cat", "cat two"] }],
      id: (document) => document.id,
      content: (document) => document.texts,
    });
    expect(documents[0]?.embeddings).toHaveLength(2);
    expect(documents[0]?.sparseEmbeddings).toHaveLength(2);
    expect(
      (await embedSparseTexts({ model: new SparseModel(), texts: ["a"] })).embeddings,
    ).toHaveLength(1);
    expect(
      (await embedSparseQuery({ model: new SparseModel(), query: "a" })).embedding.vector.indices,
    ).toEqual([1]);
  });

  it("retries failed batches and honors abort signals", async () => {
    let attempts = 0;
    const model: EmbeddingModel = {
      async embedTexts(texts) {
        attempts += 1;
        if (attempts === 1) throw Object.assign(new Error("busy"), { status: 503 });
        return texts.map((document) => ({ document, vector: [1] }));
      },
    };
    await expect(
      embedTexts({ model, texts: ["a"], retries: { maxAttempts: 2, initialDelayMs: 0 } }),
    ).resolves.toMatchObject({ embeddings: [{ vector: [1] }] });
    expect(attempts).toBe(2);
    const controller = new AbortController();
    controller.abort();
    await expect(
      embedText({ model, text: "a", abortSignal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("rejects results from embedding models that finish after cancellation", async () => {
    let finishDense: ((value: Array<{ document: string; vector: number[] }>) => void) | undefined;
    const denseModel: EmbeddingModel = {
      embedTexts: () =>
        new Promise((resolve) => {
          finishDense = resolve;
        }),
    };
    const denseAbort = new AbortController();
    const denseResult = embedTexts({
      model: denseModel,
      texts: ["late"],
      abortSignal: denseAbort.signal,
    });
    await Promise.resolve();
    denseAbort.abort();
    finishDense?.([{ document: "late", vector: [1] }]);
    await expect(denseResult).rejects.toMatchObject({ name: "AbortError" });

    let finishSparse:
      | ((
          value: Array<{ document: string; vector: { indices: number[]; values: number[] } }>,
        ) => void)
      | undefined;
    const sparseModel: SparseEmbeddingModel = {
      embedTexts: () =>
        new Promise((resolve) => {
          finishSparse = resolve;
        }),
      async embedQuery(query) {
        return { document: query, vector: { indices: [0], values: [1] } };
      },
    };
    const sparseAbort = new AbortController();
    const sparseResult = embedSparseTexts({
      model: sparseModel,
      texts: ["late"],
      abortSignal: sparseAbort.signal,
    });
    await Promise.resolve();
    sparseAbort.abort();
    finishSparse?.([{ document: "late", vector: { indices: [0], values: [1] } }]);
    await expect(sparseResult).rejects.toMatchObject({ name: "AbortError" });
  });

  it("validates concurrency, dense vectors, sparse vectors, and document chunks", async () => {
    await expect(
      embedTexts({ model: new KeywordModel(), texts: ["cat"], concurrency: 0 }),
    ).rejects.toThrow("Embedding concurrency");
    await expect(
      embedTexts({
        model: {
          dimensions: 2,
          async embedTexts() {
            return [{ document: "cat", vector: [Number.NaN, 1] }];
          },
        },
        texts: ["cat"],
      }),
    ).rejects.toThrow("non-finite vector");
    await expect(
      embedSparseQuery({
        model: {
          async embedTexts() {
            return [];
          },
          async embedQuery(query) {
            return { document: query, vector: { indices: [1], values: [] } };
          },
        },
        query: "cat",
      }),
    ).rejects.toThrow("mismatched indices and values");
    await expect(
      embedDocuments({
        model: new KeywordModel(),
        documents: ["cat"],
        content: () => [],
      }),
    ).rejects.toThrow("at least one text chunk");
  });
});

describe("vector stores and retrieval", () => {
  it("searches an in-memory store with raw vectors and replaces documents", async () => {
    const model = new KeywordModel();
    const { documents } = await embedDocuments({
      model,
      documents: [
        { id: "cat", text: "cat guide" },
        { id: "dog", text: "dog guide" },
      ],
      id: (document) => document.id,
      content: (document) => document.text,
    });
    const store = InMemoryVectorStore.fromDocuments({ documents, dimensions: 2 });
    expect(await store.search({ vector: [1, 1], topK: 1 })).toMatchObject([{ id: "cat" }]);
    const firstDocument = documents[0];
    if (firstDocument === undefined) throw new Error("Expected an embedded document");
    await store.upsert({
      documents: [{ ...firstDocument, document: { id: "cat", text: "updated" } }],
    });
    expect(store.get({ id: "cat" })?.document).toMatchObject({ text: "updated" });
  });

  it("composes dense retrieval without giving the store a model", async () => {
    const model = new KeywordModel();
    const search = vi.fn(async (_request: VectorSearchRequest) => [
      { id: "cat", score: 1, document: "Cat guide" },
    ]);
    const store = { async ensure() {}, async validate() {}, async upsert() {}, search };
    await expect(
      retrieveDocuments({ store, model, query: "cat", topK: 3, minScore: 0.5 }),
    ).resolves.toMatchObject([{ id: "cat" }]);
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({ vector: [1, 1], topK: 3, minScore: 0.5 }),
    );
  });

  it("deduplicates chunk results by document id using the best score", async () => {
    const store = {
      async ensure() {},
      async validate() {},
      async upsert() {},
      async search() {
        return [
          { id: "same", score: 0.4, document: "older chunk" },
          { id: "other", score: 0.7, document: "other" },
          { id: "same", score: 0.9, document: "best chunk" },
        ];
      },
    };
    await expect(
      retrieveDocuments({ store, model: new KeywordModel(), query: "cat", topK: 5 }),
    ).resolves.toEqual([
      { id: "same", score: 0.9, document: "best chunk" },
      { id: "other", score: 0.7, document: "other" },
    ]);
  });

  it("retries embedding and search independently", async () => {
    let embeddingAttempts = 0;
    let searchAttempts = 0;
    const model: EmbeddingModel = {
      async embedTexts(texts) {
        embeddingAttempts += 1;
        if (embeddingAttempts === 1)
          throw Object.assign(new Error("embedding busy"), { status: 503 });
        return texts.map((document) => ({ document, vector: [1] }));
      },
    };
    const store = {
      async ensure() {},
      async validate() {},
      async upsert() {},
      async search() {
        searchAttempts += 1;
        if (searchAttempts === 1) throw Object.assign(new Error("search busy"), { status: 503 });
        return [{ id: "doc", score: 1, document: "result" }];
      },
    };
    await expect(
      retrieveDocuments({
        store,
        model,
        query: "cat",
        topK: 1,
        retries: { maxAttempts: 2, initialDelayMs: 0 },
      }),
    ).resolves.toMatchObject([{ id: "doc" }]);
    expect({ embeddingAttempts, searchAttempts }).toEqual({
      embeddingAttempts: 2,
      searchAttempts: 2,
    });
  });

  it("composes hybrid retrieval only with a hybrid-capable store", async () => {
    const searchHybrid = vi.fn(async (_request: HybridVectorSearchRequest) => [
      { id: "hybrid", score: 0.9, document: "Hybrid" },
    ]);
    const store: HybridVectorStore<string> = {
      async ensure() {},
      async validate() {},
      async upsert(_options: VectorStoreUpsertOptions<string>) {},
      async search() {
        return [];
      },
      searchHybrid,
    };
    const results = await retrieveDocuments({
      store,
      models: { dense: new KeywordModel(), sparse: new SparseModel() },
      query: "cat",
      topK: 2,
      fusion: "rrf",
    });
    expect(results[0]?.id).toBe("hybrid");
    expect(searchHybrid).toHaveBeenCalledWith(
      expect.objectContaining({
        vector: [1, 1],
        sparseVector: { indices: [1], values: [2] },
        fusion: "rrf",
      }),
    );
  });

  it("creates an explicit model-plus-store search tool", async () => {
    const model = new KeywordModel();
    const store = InMemoryVectorStore.fromDocuments({
      documents: [
        { id: "cat", document: "Cat guide", embeddings: [{ document: "cat", vector: [1, 1] }] },
      ],
      dimensions: 2,
    });
    const tool = createVectorSearchTool({
      store,
      model,
      name: "search_notes",
      topK: 1,
      minScore: 0.5,
    });
    await expect(tool.call({ query: "cat" })).resolves.toMatchObject([{ id: "cat" }]);
    await expect(tool.call({ query: "cat", topK: 0 })).rejects.toThrow();
  });

  it("keeps tool filters fixed, uses configured topK, and forwards abort signals", async () => {
    const controller = new AbortController();
    const search = vi.fn(async (_request: VectorSearchRequest) => [
      { id: "cat", score: 1, document: "Cat guide" },
    ]);
    const store = { async ensure() {}, async validate() {}, async upsert() {}, search };
    const filter = { type: "eq", key: "tenantId", value: "tenant-a" } as const;
    const tool = createVectorSearchTool({
      store,
      model: new KeywordModel(),
      name: "search_notes",
      topK: 4,
      minScore: 0.7,
      filter,
    });
    await tool.call({ query: "cat" }, { abortSignal: controller.signal });
    expect(search).toHaveBeenLastCalledWith({
      vector: [1, 1],
      topK: 4,
      minScore: 0.7,
      filter,
      abortSignal: controller.signal,
    });
    await tool.call({ query: "cat", topK: 2 });
    expect(search).toHaveBeenLastCalledWith(expect.objectContaining({ topK: 2, filter }));
  });

  it("creates explicit vector contexts", () => {
    const context = createVectorContext({
      store: new InMemoryVectorStore<string>({ dimensions: 2 }),
      model: new KeywordModel(),
      topK: 2,
      minScore: 0.25,
    });
    expect(isVectorContext(context)).toBe(true);
    expect(context.kind).toBe("vector-context");
  });
});
