---
"@anvia/core": patch
"@anvia/langfuse": patch
"@anvia/pgvector": patch
---

Update upstream dependencies for PDF loading, globbing, Langfuse tracing, and pgvector support.

The PDF loader now destroys the `pdfjs-dist` loading task after reading pages, matching the v6 cleanup API.
