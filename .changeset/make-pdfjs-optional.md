---
"@anvia/core": patch
---

Make `pdfjs-dist` an optional peer dependency so applications that do not use PDF text extraction
avoid installing PDF.js and its native canvas dependency. Applications using `extractPdfText` must
install `pdfjs-dist` directly.
