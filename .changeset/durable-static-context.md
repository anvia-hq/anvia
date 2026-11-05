---
"@anvia/durable": minor
---

Accept static `Document` context in durable agents (parity Phase 1).

- Registration no longer rejects an agent `context` that contains only static `Document` entries.
  `VectorContext` entries are still rejected, with the same message naming `context`.
- The resolved documents are snapshotted into the run record at submission (`contextDocuments`,
  with a content hash), so a restart or retry replays exactly the same context. Large document sets
  persist through the blob table; the hash stays inline.
- At every execution start the runtime re-hashes the registration's current documents and compares
  them with the run's snapshot. A mismatch under the same registration version fails the run with a
  `DurableRecoveryError` (status `needs_attention`) naming both hashes, instead of silently changing
  context. Restoring the original documents and calling `retry()` resumes the run.
