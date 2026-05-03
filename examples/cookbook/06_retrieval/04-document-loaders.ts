import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type EmbeddingModel, embedDocuments } from "@anvia/core/embeddings";
import {
  FileLoader,
  fileLoaderToDocuments,
  PdfFileLoader,
  pdfPageLoaderToDocuments,
} from "@anvia/core/loaders";
import { InMemoryVectorStore } from "@anvia/core/vector-store";

class KeywordEmbeddingModel implements EmbeddingModel {
  readonly dimensions = 4;

  async embedTexts(texts: string[]) {
    return texts.map((text) => ({
      document: text,
      vector: vectorize(text),
    }));
  }
}

const dataDir = join(dirname(fileURLToPath(import.meta.url)), "..", ".memory", "loaders");
await mkdir(dataDir, { recursive: true });

await writeFile(
  join(dataDir, "refunds.txt"),
  "Refund requests are reviewed within two business days.",
);
await writeFile(join(dataDir, "access.txt"), "Password reset links expire after 30 minutes.");

const textDocuments = await fileLoaderToDocuments(
  FileLoader.withGlob(join(dataDir, "*.txt")).readWithPath().ignoreErrors(),
);

const pdfPath = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "pages.pdf");
const pdfDocuments = await pdfPageLoaderToDocuments(
  PdfFileLoader.withGlob(pdfPath).readWithPath().byPage().ignoreErrors(),
);

const documents = [...textDocuments, ...pdfDocuments];
const embeddingModel = new KeywordEmbeddingModel();
const embedded = await embedDocuments(embeddingModel, documents, {
  id: (document) => document.id,
  content: (document) => document.text,
  metadata: (document) => ({
    source: document.additionalProps?.source ?? document.id,
    pageNumber: document.additionalProps?.pageNumber ?? null,
  }),
});

const store = InMemoryVectorStore.fromDocuments(embedded);
const results = await store.index(embeddingModel).search({
  query: "pdf page",
  topK: 2,
});

console.log(
  results.map((result) => ({
    id: result.id,
    score: result.score,
    source: result.metadata?.source,
    pageNumber: result.metadata?.pageNumber,
  })),
);

function vectorize(text: string): number[] {
  const lower = text.toLowerCase();
  return [
    lower.includes("refund") ? 1 : 0,
    lower.includes("password") || lower.includes("access") ? 1 : 0,
    lower.includes("pdf") || lower.includes("policy") || lower.includes("page") ? 1 : 0,
    Math.min(1, text.length / 120),
  ];
}
