---
"@anvia/durable": patch
---

Store oversized prompts as blob references instead of inline JSON.

- A submitted prompt above 64 KiB is written to the blob table. The run record, its `input`
  messages, and the `submitted` event keep a bounded reference. The run and its events read back the
  full prompt, after a restart too. Prompts below the threshold stay inline, as before.
- Prompt byte budgets still apply to the logical prompt, so admission does not change.
- The SQLite schema moves from version 11 to 12. Opening a version 11 or older store rewrites its
  oversized prompts once. Maintenance and backup accept version 12.
