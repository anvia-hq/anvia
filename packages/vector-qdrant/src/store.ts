import type { EmbeddedDocument, EmbeddingModel, VectorMetadata } from "@anvia/core/embeddings";
import type { VectorInspectItem } from "@anvia/core/vector-store";
import {
  defaultQdrantClient,
  isQdrantNotFoundError,
  qdrantCollectionExists,
  qdrantDocumentFilter,
  qdrantDocumentPage,
  qdrantMutationRequest,
  qdrantPoints,
  validateQdrantCollection,
} from "./helpers.js";
import { QdrantVectorIndex } from "./search-index.js";
import {
  defaultDenseVectorName,
  defaultSparseVectorName,
  isQdrantHybridIndexOptions,
  type QdrantClientLike,
  type QdrantIndexOptions,
  type QdrantMutationOptions,
  type QdrantVectorStoreConnectOptions,
} from "./types.js";

export class QdrantVectorStore<T, Metadata extends VectorMetadata = VectorMetadata> {
  private constructor(
    private readonly client: QdrantClientLike,
    private readonly collectionName: string,
    private readonly options: {
      hybrid: boolean;
      denseVectorName: string;
      sparseVectorName: string;
    },
  ) {}

  static async connect<T, Metadata extends VectorMetadata = VectorMetadata>(
    options: QdrantVectorStoreConnectOptions,
  ): Promise<QdrantVectorStore<T, Metadata>> {
    if (options.client !== undefined && options.clientOptions !== undefined) {
      throw new TypeError("Qdrant connect accepts either client or clientOptions, but not both.");
    }
    const client = options.client ?? (await defaultQdrantClient(options.clientOptions));
    const hybrid = options.hybrid === true;
    const denseVectorName = options.denseVectorName ?? defaultDenseVectorName;
    const sparseVectorName = options.sparseVectorName ?? defaultSparseVectorName;
    const storeOptions = { hybrid, denseVectorName, sparseVectorName };
    const collectionOptions = {
      vectorSize: options.vectorSize,
      distance: options.distance ?? ("Cosine" as const),
      ...storeOptions,
    };

    if (options.createIfMissing === false) {
      validateQdrantCollection(
        await client.getCollection(options.collectionName),
        collectionOptions,
      );
      return new QdrantVectorStore<T, Metadata>(client, options.collectionName, storeOptions);
    }

    let exists: boolean | undefined;
    if (typeof client.collectionExists === "function") {
      exists = qdrantCollectionExists(await client.collectionExists(options.collectionName));
    }

    if (exists === true) {
      validateQdrantCollection(
        await client.getCollection(options.collectionName),
        collectionOptions,
      );
    } else if (exists === false) {
      await createCollection(client, options, storeOptions);
    } else {
      try {
        validateQdrantCollection(
          await client.getCollection(options.collectionName),
          collectionOptions,
        );
      } catch (error) {
        if (!isQdrantNotFoundError(error)) {
          throw error;
        }
        await createCollection(client, options, storeOptions);
      }
    }
    return new QdrantVectorStore<T, Metadata>(client, options.collectionName, storeOptions);
  }

  async upsertDocuments(
    documents: Array<EmbeddedDocument<T, Metadata>>,
    mutationOptions: QdrantMutationOptions = {},
  ): Promise<void> {
    const points = documents.flatMap((document) =>
      qdrantPoints(document, {
        hybrid: this.options.hybrid,
        denseVectorName: this.options.denseVectorName,
        sparseVectorName: this.options.sparseVectorName,
      }),
    );
    if (points.length === 0) {
      return;
    }

    const documentIds = [...new Set(documents.map((document) => document.id))];
    const filter = qdrantDocumentFilter(documentIds);
    const requestOptions = qdrantMutationRequest(mutationOptions);
    if (typeof this.client.batchUpdate === "function") {
      await this.client.batchUpdate(this.collectionName, {
        ...requestOptions,
        operations: [{ delete: { filter } }, { upsert: { points } }],
      });
      return;
    }

    // Older custom clients may not implement batchUpdate. Delete first so replacing a document with
    // fewer embeddings does not leave stale points behind. The delete must finish before the upsert
    // when the operations cannot be submitted as one ordered batch. This path is not atomic: if the
    // upsert fails, the previous points have already been deleted.
    if (typeof this.client.delete !== "function") {
      throw new TypeError(
        "Qdrant document replacement requires a client that implements batchUpdate(...) or delete(...).",
      );
    }
    await this.client.delete(this.collectionName, { ...requestOptions, wait: true, filter });
    await this.client.upsert(this.collectionName, { ...requestOptions, points });
  }

  async deleteDocuments(
    documentIds: string[],
    mutationOptions: QdrantMutationOptions = {},
  ): Promise<void> {
    const ids = [...new Set(documentIds)];
    if (ids.length === 0) {
      return;
    }
    if (typeof this.client.delete !== "function") {
      throw new TypeError(
        "Qdrant document deletion requires a client that implements delete(...).",
      );
    }
    await this.client.delete(this.collectionName, {
      ...qdrantMutationRequest(mutationOptions),
      filter: qdrantDocumentFilter(ids),
    });
  }

  async getDocuments(documentIds: string[]): Promise<Array<VectorInspectItem<T, Metadata>>> {
    const ids = [...new Set(documentIds)];
    if (ids.length === 0) {
      return [];
    }
    const page = await qdrantDocumentPage<T, Metadata>(this.client, this.collectionName, {
      limit: ids.length,
      filter: qdrantDocumentFilter(ids),
    });
    const byId = new Map(page.items.map((item) => [item.id, item]));
    return ids.flatMap((id) => {
      const item = byId.get(id);
      return item === undefined ? [] : [item];
    });
  }

  index(options: QdrantIndexOptions): QdrantVectorIndex<T, Metadata> {
    if (isQdrantHybridIndexOptions(options)) {
      if (!this.options.hybrid) {
        throw new TypeError(
          "Hybrid Qdrant index requires QdrantVectorStore.connect({ hybrid: true }).",
        );
      }
      return new QdrantVectorIndex(options.dense, this.client, this.collectionName, {
        sparse: options.sparse,
        fusion: options.fusion ?? "rrf",
        denseVectorName: options.denseVectorName ?? this.options.denseVectorName,
        sparseVectorName: options.sparseVectorName ?? this.options.sparseVectorName,
        prefetchLimit: options.prefetchLimit,
      });
    }
    if (this.options.hybrid) {
      throw new TypeError(
        "Dense-only Qdrant index requires store.index({ dense, sparse }) when the collection was created with hybrid: true.",
      );
    }
    return new QdrantVectorIndex(options as EmbeddingModel, this.client, this.collectionName);
  }
}

async function createCollection(
  client: QdrantClientLike,
  options: QdrantVectorStoreConnectOptions,
  storeOptions: {
    hybrid: boolean;
    denseVectorName: string;
    sparseVectorName: string;
  },
): Promise<void> {
  if (storeOptions.hybrid) {
    await client.createCollection(options.collectionName, {
      vectors: {
        [storeOptions.denseVectorName]: {
          size: options.vectorSize,
          distance: options.distance ?? "Cosine",
        },
      },
      sparse_vectors: {
        [storeOptions.sparseVectorName]: {},
      },
    });
  } else {
    await client.createCollection(options.collectionName, {
      vectors: {
        size: options.vectorSize,
        distance: options.distance ?? "Cosine",
      },
    });
  }
}
