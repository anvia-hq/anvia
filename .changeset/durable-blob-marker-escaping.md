---
"@anvia/durable": patch
---

Stop user data shaped like blob references from being read as references.

- Data containing `anvia:blob`, `anvia:blobs`, or `metadata.anvia.durableBlobs` used to be
  interpreted as a reference: a missing blob threw, and an existing hash returned another blob's
  content. Those keys are now escaped when a record is written (a leading `~`) and restored when
  it is read, so the data round-trips unchanged. Only runtime-created references are interpreted.
- The SQLite schema moves from version 10 to 11. Opening a version 10 or older store rewrites its
  journal rows once: user keys are escaped, well-formed references whose blobs exist are kept, and
  message histories are re-hashed with their references renamed. Maintenance and backup accept
  version 11.
- Known limit: in rows written before this version, a user object that copies an existing blob's
  marker (same hash and size) cannot be told apart from a real reference.
