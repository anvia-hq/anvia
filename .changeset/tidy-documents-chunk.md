---
"@anvia/core": patch
---

Remove local PDF text extraction and the optional `pdfjs-dist` dependency from Core. PDF attachment
contracts remain available for provider adapters, while applications retain ownership of document
parsing before using Core text chunking.
