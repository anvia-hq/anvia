---
"@anvia/core": patch
---

Replace the stateful filesystem and PDF loader API with explicit in-memory `chunkText` strategies
and abortable `extractPdfText` parsing under `@anvia/core/documents`. Applications now own file
discovery, reads, source metadata, document mapping, and error policy.
