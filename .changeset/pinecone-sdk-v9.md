---
"@anvia/pinecone": minor
---

Upgrade the Pinecone SDK to 9.0.0, which requires Node.js 22 or later and targets Pinecone API 2026-07. Existing vector upsert, query, and delete operations remain supported. Index provisioning supports serverless and BYOC specifications; legacy pod creation, metadata-indexing schemas, and sourceCollection/sourceBackupId creation options are no longer supported by the upstream SDK.
