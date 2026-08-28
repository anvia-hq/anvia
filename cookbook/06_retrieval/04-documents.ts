import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Document } from "@anvia/core/completion";
import { chunkText } from "@anvia/core/documents";
import { type EmbeddingModel, embedDocuments } from "@anvia/core/embeddings";
import { InMemoryVectorStore, retrieveDocuments } from "@anvia/core/vector-store";

class KeywordEmbeddingModel implements EmbeddingModel {
  readonly provider = "cookbook";
  readonly modelId = "keyword";
  readonly dimensions = 3;

  async embedTexts(texts: string[]) {
    return texts.map((text) => ({
      document: text,
      vector: vectorize(text),
    }));
  }
}

const exampleDir = dirname(fileURLToPath(import.meta.url));
const dataDir = join(exampleDir, "..", ".memory", "documents");
await mkdir(dataDir, { recursive: true });

const textPaths = [join(dataDir, "refunds.txt"), join(dataDir, "access.txt")] as const;
await Promise.all([
  writeFile(textPaths[0], "Refund requests are reviewed within two business days."),
  writeFile(textPaths[1], "Password reset links expire after 30 minutes."),
]);

const textDocuments = (
  await Promise.all(
    textPaths.map(async (path) => {
      const text = await readFile(path, "utf8");
      return chunkText({
        text,
        strategy: "recursive",
        maxSize: 80,
        overlap: 10,
        separators: ["\n\n", "\n", " "],
      }).map((chunk): Document => ({
        id: `${path}#chunk=${chunk.index}`,
        text: chunk.text,
        additionalProps: {
          source: path,
          mediaType: "text/plain",
          chunkIndex: String(chunk.index),
        },
      }));
    }),
  )
).flat();

const embeddingModel = new KeywordEmbeddingModel();
const { documents: embedded } = await embedDocuments({
  model: embeddingModel,
  documents: textDocuments,
  id: (document) => document.id,
  content: (document) => document.text,
  metadata: (document) => ({
    source: document.additionalProps?.source ?? document.id,
  }),
});

const store = InMemoryVectorStore.fromDocuments({ documents: embedded });
const results = await retrieveDocuments({
  store,
  model: embeddingModel,
  query: "password access",
  topK: 2,
});

console.log(
  results.map((result) => ({
    id: result.id,
    score: result.score,
    source: result.metadata?.source,
  })),
);

function vectorize(text: string): number[] {
  const lower = text.toLowerCase();
  return [
    lower.includes("refund") ? 1 : 0,
    lower.includes("password") || lower.includes("access") ? 1 : 0,
    Math.min(1, text.length / 120),
  ];
}
