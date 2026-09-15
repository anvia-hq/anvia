# @anvia/pinecone

Pinecone vector-store adapter for Anvia.

## Runtime and SDK compatibility

This package uses Pinecone SDK 9 and requires Node.js 22 or later. The SDK targets
Pinecone API version `2026-07`.

`PineconeVectorClient` supports classic vector operations, including upsert, query,
and delete. When provisioning a missing index with `store.ensure()`, use a supported
serverless or BYOC `spec`. SDK 9 no longer supports creating legacy pod indexes,
legacy metadata-indexing schemas, or `sourceCollection`/`sourceBackupId` creation
options. Existing pod indexes remain manageable.

See the [upstream migration notes](https://github.com/pinecone-io/pinecone-ts-client/releases/tag/v9.0.0)
for details. External Anvia installation and Pinecone provisioning documentation
should reflect the Node.js 22 minimum and these provisioning restrictions.
