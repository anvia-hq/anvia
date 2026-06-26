---
title: Loaders
description: Load files, PDFs, and document content for agent knowledge.
section: advanced
sidebar:
  group: Knowledge and retrieval
  order: 30
---

Loaders are ingestion helpers. They read local text, bytes, and PDFs before you embed documents or build a retrieval index.

Use loaders in build jobs, admin imports, startup tasks, or background workers. Do not put file loading in the hot path of every prompt unless the source is intentionally request-scoped.

Import loaders from the server-only subpath:

```ts
import { FileLoader, PdfFileLoader } from "@anvia/core/loaders";
```

The loader package uses Node filesystem and PDF extraction APIs. Keep it out of browser bundles.

## Text Files

Use `FileLoader` for UTF-8 text files such as Markdown, plain text, generated docs, or exported runbooks:

```ts
import { FileLoader, fileLoaderToDocuments } from "@anvia/core/loaders";

const textDocuments = await fileLoaderToDocuments(
  FileLoader.withGlob("content/support/**/*.md").readWithPath().ignoreErrors(),
);
```

`readWithPath()` preserves the source path. `fileLoaderToDocuments(...)` maps each file to a `Document` with:

- `id` set to the file path
- `text` set to the file contents
- `additionalProps.source` set to the file path
- `additionalProps.mediaType` set to `text/plain`

Use `withGlob(...)` for recursive or pattern-based ingestion. Use `withDir(...)` when you only want direct files in one directory:

```ts
const articles = await fileLoaderToDocuments(
  FileLoader.withDir("content/articles").readWithPath().ignoreErrors(),
);
```

`withDir(...)` does not recurse into nested directories.

## Bytes

Use byte loaders when the source comes from uploads, object storage, generated artifacts, or another runtime system:

```ts
const bytes = new TextEncoder().encode("Password reset links expire after 30 minutes.");

const documents = await fileLoaderToDocuments(
  FileLoader.fromBytes(bytes).readWithPath().ignoreErrors(),
);
```

Byte-loaded files use `"<memory>"` as their path. Replace or enrich that source metadata before embedding when you need audit-friendly provenance.

## PDFs

Use `PdfFileLoader` for PDF source material:

```ts
import { PdfFileLoader, pdfLoaderToDocuments } from "@anvia/core/loaders";

const manuals = await pdfLoaderToDocuments(
  PdfFileLoader.withGlob("manuals/**/*.pdf").readWithPath().ignoreErrors(),
);
```

This creates one document per PDF. Use it when each PDF is small enough that the whole file should be retrieved together.

For most product knowledge, page-level documents are easier to retrieve and cite:

```ts
import { PdfFileLoader, pdfPageLoaderToDocuments } from "@anvia/core/loaders";

const manualPages = await pdfPageLoaderToDocuments(
  PdfFileLoader.withGlob("manuals/**/*.pdf").readWithPath().byPage().ignoreErrors(),
);
```

PDF page documents include `source`, `mediaType`, and a zero-based `pageNumber` in `additionalProps`.

## Error Handling

Loaders yield `LoaderResult<T>` by default:

```ts
for await (const result of FileLoader.withGlob("content/**/*.md").readWithPath()) {
  if (result.ok) {
    await indexFile(result.value);
  } else {
    await reportIngestionError(result.error);
  }
}
```

Call `.ignoreErrors()` when an ingestion job should skip failed records and continue. That is useful for large backfills, but production import jobs should still report skipped files so missing knowledge is visible.

## Chunking

Core loaders do not chunk arbitrary text beyond PDF pages. Do chunking in application code before embedding:

```ts
const chunks = textDocuments.flatMap((document) =>
  splitIntoSections(document.text).map((section, index) => ({
    id: `${document.id}#section=${index}`,
    text: section,
    source: document.additionalProps?.source ?? document.id,
  })),
);
```

Keep chunk ids stable. Stable ids make it possible to replace changed documents without duplicating old content.

## Embed Loaded Documents

After loading and optional chunking, embed the documents:

```ts
import { embedDocuments } from "@anvia/core/embeddings";

const embedded = await embedDocuments(embeddingModel, textDocuments, {
  id: (document) => document.id,
  content: (document) => document.text,
  metadata: (document) => ({
    source: document.additionalProps?.source ?? document.id,
    mediaType: document.additionalProps?.mediaType ?? "text/plain",
  }),
});
```

The loader step is only the first part of retrieval. The runtime agent should receive a prepared index, not raw files.
