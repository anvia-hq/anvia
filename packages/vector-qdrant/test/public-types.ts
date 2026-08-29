import {
  QdrantVectorClient,
  QdrantVectorStore,
  type QdrantDenseVectorStoreOptions,
} from "../src/index.js";

declare const client: QdrantVectorClient;
declare const options: QdrantDenseVectorStoreOptions;

new QdrantVectorStore(client, options);
// @ts-expect-error Raw namespaces cannot bypass client.tenant().
new QdrantVectorStore(client, options, "raw-user-id");
