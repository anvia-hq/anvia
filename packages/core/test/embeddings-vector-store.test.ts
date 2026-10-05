import { describe, expect, it, vi } from "vitest";
import {
  createVectorContext,
  createVectorSearchTool,
  type Embedding,
  type EmbeddingModel,
  type EmbeddingOperationOptions,
  embedDocuments,
  embedSparseQuery,
  embedSparseTexts,
  embedText,
  embedTexts,
  type HybridVectorSearchRequest,
  type HybridVectorStore,
  InMemoryVectorStore,
  ingestVectorDocuments,
  ingestVectorText,
  isVectorContext,
  retrieveDocuments,
  type SparseEmbedding,
  type SparseEmbeddingModel,
  type VectorSearchRequest,
  type VectorStoreUpsertOptions,
} from "./helpers/imports";

class KeywordModel implements EmbeddingModel {
  readonly provider = "test";
  readonly modelId = "keyword";
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
  readonly provider = "test";
  readonly modelId = "sparse";
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
      provider: "test",
      modelId: "retry",
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
      provider: "test",
      modelId: "late-dense",
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
      provider: "test",
      modelId: "late-sparse",
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
          provider: "test",
          modelId: "invalid-dense",
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
          provider: "test",
          modelId: "invalid-sparse",
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

describe.each(["dense", "sparse"] as const)("%s batch cardinality", (channel) => {
  const vector = (document: string): Embedding | SparseEmbedding =>
    channel === "dense"
      ? { document, vector: [1] }
      : { document, vector: { indices: [0], values: [1] } };
  const diagnostic = (count: number) =>
    `${channel === "dense" ? "Embedding" : "Sparse embedding"} model returned ${count} embeddings for 2 texts`;

  function fixture(
    provide: (texts: string[], attempt: number) => Promise<Array<Embedding | SparseEmbedding>>,
  ) {
    let attempts = 0;
    const common = { provider: "test", modelId: "batch-count", maxBatchSize: 2 };
    const dense: EmbeddingModel = {
      ...common,
      async embedTexts(texts) {
        return (await provide(texts, ++attempts)) as Embedding[];
      },
    };
    const sparse: SparseEmbeddingModel = {
      ...common,
      async embedTexts(texts) {
        return (await provide(texts, ++attempts)) as SparseEmbedding[];
      },
      async embedQuery(query) {
        return { document: query, vector: { indices: [0], values: [1] } };
      },
    };
    return {
      attempts: () => attempts,
      run: (texts: string[], options: EmbeddingOperationOptions & { concurrency?: number } = {}) =>
        channel === "dense"
          ? embedTexts({ model: dense, texts, ...options })
          : embedSparseTexts({ model: sparse, texts, ...options }),
      documents: () =>
        channel === "dense"
          ? embedDocuments({ model: dense, documents: ["a", "b"], content: (text) => text })
          : embedDocuments({
              models: { dense: new KeywordModel(), sparse },
              documents: ["a", "b"],
              content: (text) => text,
            }),
    };
  }

  it.each([1, 3])("rejects a batch count of %i before compensating batches run", async (count) => {
    const provider = fixture(async (_, attempt) =>
      Array.from({ length: attempt === 1 ? count : 4 - count }, () => vector("wrong")),
    );
    await expect(provider.run(["a", "b", "c", "d"])).rejects.toThrow(diagnostic(count));
    expect(provider.attempts()).toBe(1);
    await expect(provider.documents()).rejects.toThrow(diagnostic(4 - count));
  });

  it("does not retry malformed successful batches under an always-retry policy", async () => {
    const provider = fixture(async () => [vector("a")]);
    await expect(
      provider.run(["a", "b", "c", "d"], {
        retries: { maxAttempts: 3, initialDelayMs: 0, shouldRetry: () => true },
      }),
    ).rejects.toThrow(diagnostic(1));
    expect(provider.attempts()).toBe(1);
  });

  it("captures the requested count before the provider mutates its input batch", async () => {
    const provider = fixture(async (texts) => {
      texts.pop();
      return texts.map(vector);
    });
    await expect(provider.run(["a", "b"])).rejects.toThrow(diagnostic(1));
    expect(provider.attempts()).toBe(1);
  });

  it.each(["pop", "push", "replace"] as const)(
    "owns accepted batch containers when a provider uses %s while a sibling is pending",
    async (mutation) => {
      const retained = [vector("a"), vector("b")];
      const original = [...retained];
      let finish!: (value: Array<Embedding | SparseEmbedding>) => void;
      let started!: () => void;
      const siblingStarted = new Promise<void>((resolve) => {
        started = resolve;
      });
      const provider = fixture(async (_, attempt) => {
        if (attempt === 1) return retained;
        started();
        return new Promise((resolve) => {
          finish = resolve;
        });
      });
      const result = provider.run(["a", "b", "c", "d"], { concurrency: 2 });
      await siblingStarted;
      await new Promise<void>((resolve) => setImmediate(resolve));
      if (mutation === "pop") retained.pop();
      if (mutation === "push") retained.push(vector("extra"));
      if (mutation === "replace") retained[0] = vector("replacement");
      finish([vector("c"), vector("d")]);
      const { embeddings } = await result;
      expect(embeddings.map((item) => item.document)).toEqual(["a", "b", "c", "d"]);
      expect(embeddings[0]).toBe(original[0]);
      expect(embeddings[1]).toBe(original[1]);
      expect(provider.attempts()).toBe(2);
    },
  );

  it("preserves order when batches finish in reverse", async () => {
    let finishFirst!: (value: Array<Embedding | SparseEmbedding>) => void;
    let secondFinished!: () => void;
    const second = new Promise<void>((resolve) => {
      secondFinished = resolve;
    });
    const provider = fixture(async (texts, attempt) => {
      if (attempt === 1) {
        return new Promise((resolve) => {
          finishFirst = resolve;
        });
      }
      secondFinished();
      return texts.map(vector);
    });
    const result = provider.run(["a", "b", "c", "d"], { concurrency: 2 });
    await second;
    finishFirst([vector("a"), vector("b")]);
    expect((await result).embeddings.map((item) => item.document)).toEqual(["a", "b", "c", "d"]);
    expect(provider.attempts()).toBe(2);
  });

  it("returns empty and singleton controls without extra calls", async () => {
    const provider = fixture(async (texts) => texts.map(vector));
    await expect(provider.run([])).resolves.toEqual({ embeddings: [] });
    expect(provider.attempts()).toBe(0);
    await expect(provider.run(["a"])).resolves.toEqual({
      embeddings:
        channel === "dense"
          ? [{ document: "a", vector: [1] }]
          : [{ document: "a", vector: { indices: [0], values: [1] } }],
    });
    expect(provider.attempts()).toBe(1);
  });

  it("preserves shape error precedence over cardinality", async () => {
    const provider = fixture(async () => [
      channel === "dense"
        ? { document: "a", vector: [Number.NaN] }
        : { document: "a", vector: { indices: [0, 0], values: [1, 1] } },
    ]);
    await expect(provider.run(["a", "b"])).rejects.toThrow(
      channel === "dense" ? "non-finite vector" : "duplicate indices",
    );
    expect(provider.attempts()).toBe(1);
  });
});

describe("embedding document batch controls", () => {
  it.each(["dense", "sparse"] as const)(
    "rejects a malformed %s hybrid channel",
    async (channel) => {
      const dense: EmbeddingModel = {
        provider: "test",
        modelId: "dense",
        async embedTexts(texts) {
          return (channel === "dense" ? texts.slice(0, 1) : texts).map((document) => ({
            document,
            vector: [1],
          }));
        },
      };
      const sparse: SparseEmbeddingModel = {
        provider: "test",
        modelId: "sparse",
        async embedTexts(texts) {
          return (channel === "sparse" ? texts.slice(0, 1) : texts).map((document) => ({
            document,
            vector: { indices: [0], values: [1] },
          }));
        },
        async embedQuery(query) {
          return { document: query, vector: { indices: [0], values: [1] } };
        },
      };
      await expect(
        embedDocuments({
          models: { dense, sparse },
          documents: ["a", "b"],
          content: (text) => text,
        }),
      ).rejects.toThrow(
        `${channel === "dense" ? "Embedding" : "Sparse embedding"} model returned 1 embeddings for 2 texts`,
      );
    },
  );

  it("preserves chunk alignment and source metadata for hybrid documents", async () => {
    const { documents } = await embedDocuments({
      models: { dense: new KeywordModel(), sparse: new SparseModel() },
      documents: [{ chunks: ["a", "b"], source: "x" }],
      content: (document) => document.chunks,
      metadata: (document) => ({ source: document.source }),
    });
    expect(documents[0]?.embeddings.map((item) => item.document)).toEqual(["a", "b"]);
    expect(documents[0]?.sparseEmbeddings?.map((item) => item.document)).toEqual(["a", "b"]);
    expect(documents[0]?.metadata).toEqual({ source: "x" });
  });
});

describe("vector stores and retrieval", () => {
  it("ingests chunked text while preserving document-scoped replacement", async () => {
    const store = new InMemoryVectorStore<{
      id: string;
      text: string;
      metadata?: { tenant: string } | undefined;
    }>();
    const first = await ingestVectorDocuments({
      store,
      documents: [{ id: "incident", text: "cat abcdef", metadata: { tenant: "one" } }],
      embeddingModel: new KeywordModel(),
      chunking: { strategy: "fixed", maxSize: 4 },
    });

    expect(first.documents).toHaveLength(1);
    expect(first.documents[0]).toMatchObject({ id: "incident", metadata: { tenant: "one" } });
    expect(first.documents[0]?.embeddings).toHaveLength(3);

    await ingestVectorText({
      store,
      document: { id: "incident", text: "cat", metadata: { tenant: "one" } },
      embeddingModel: new KeywordModel(),
      chunking: { strategy: "fixed", maxSize: 4 },
    });
    expect(store.get({ id: "incident" })?.embeddings).toHaveLength(1);

    await expect(
      ingestVectorText({
        store,
        document: { id: "invalid", text: "cat", metadata: { score: Number.NaN } } as never,
        embeddingModel: new KeywordModel(),
      }),
    ).rejects.toThrow("finite vector metadata value");
  });

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
      provider: "test",
      modelId: "retry-retrieval",
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
