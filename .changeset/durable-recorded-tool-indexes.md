---
"@anvia/durable": minor
---

Admit dynamic tool indexes behind an explicit marker (experimental, parity phase 5).

- Registration accepts `toolIndexes: { mode: "recorded" }`. Without it, tool indexes are still
  rejected, and the error names the marker.
- Each model call's tool selection is recorded before the call. A restart or retry offers the
  recorded tools and does not run the index search again.
- The run stores a fingerprint of the indexes (search settings and tool definitions) at submission.
  A change under the same registration version fails the run with `needs_attention`. The embedding
  model is not part of the fingerprint, so bump the version when it changes.
