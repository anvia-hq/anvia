---
"@anvia/durable": minor
---

Store oversized payloads as blob references instead of failing the run (DUR-05).

- The SQLite schema moves from version 9 to 11, adding an `anvia_durable_blobs` table. The table is
  created on open and existing stores (versions 1–10) migrate on ownership acquisition, keeping all
  runs readable. Backup/restore accepts versions up to 11.
- Tool results, model results, run outcomes (text, output, and messages), exhaustion transcripts,
  context-operation transcripts, and large message leaves (text, reasoning, image/file data,
  tool-call inputs, tool-result outputs) larger than 64 KiB move to the blob table, inside the same
  transaction as the record that references them. Journal records keep a bounded, content-addressed
  reference (`anvia:blob` markers), so an oversized tool result or model outcome no longer fails a
  run or inflates session history.
- Execution is unchanged for models and tools: requests sent to the provider and results returned
  to the agent loop are always fully restored from the blob table. `run()`, `snapshot()`,
  `operationRequest()`, and event reads hydrate references as well. Replay comparisons run on the
  deterministic stored forms, so a replayed run produces byte-identical references.
- `DurableTransaction` gains `putBlob`/`getBlob`. Payload limits still apply to the stored
  (bounded) forms; blob writes themselves are not limit-checked.
- Not covered: media in submitted prompts still counts against the prompt budget at admission, and
  blobs are never garbage-collected (there is no retention yet).
