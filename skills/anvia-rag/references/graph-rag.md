# Graph RAG

Use a knowledge graph when the questions are about connections (which incidents
affect which products, who owns what) — vectors find similar text, graphs
traverse relationships. The two compose: managed ingestion embeds chunks for a
vector store while extracting facts for the graph.

Core primitives live in `@anvia/graph`; provisioning, persistence, and queries
belong to adapters (`@anvia/neo4j`, `@anvia/memgraph`).

## Schema first

```ts
import { defineGraphSchema } from "@anvia/graph";

const schema = defineGraphSchema({
  nodes: {
    Product: {
      description: "A product or service.",
      identity: ["id"],
      properties: z.strictObject({ id: z.string(), name: z.string() }),
    },
  },
  relationships: {
    AFFECTS: {
      description: "An incident affects a product.",
      from: "Incident",
      to: "Product",
      properties: z.strictObject({ severity: z.enum(["low", "medium", "high"]) }),
    },
  },
});
```

Design the schema from the questions, not the source tables. `identity` fields
are how facts merge — wrong identity modeling duplicates entities forever.

## Ingestion

```ts
import { ingestGraphText } from "@anvia/graph";

const ingestion = await ingestGraphText({
  graph,
  document: { id: "incident-42", text, metadata: { tenant: "acme" } },
  extractionModel,
  embeddingModel,
  chunking: {
    strategy: "recursive",
    maxSize: 1_000,
    overlap: 100,
    separators: ["\n\n", "\n", " "],
  },
  conflict: "error",
  orphanEntities: "delete",
  factConflicts: {
    entity: { properties: { summary: "prefer-longest", aliases: "union", confidence: "max" } },
  },
});
```

- Managed graphs accept the same raw-text shape as vector ingestion, so reuse
  your chunking settings. `ingestGraphDocuments()` batches; `ingestGraphTextToStores()`
  writes graph + vector store in one call.
- Two conflict policies: `factConflicts` (disagreements between chunks, rejected
  by default — strategies like `prefer-longest`, `union`, `max`), and `conflict`
  (collisions with already-stored facts). Read both errors; they carry fact
  type, stable key, identity, and source chunk IDs.
- Graph and vector writes are separate transactions. On partial failure
  (`GraphIngestionStageError`) reconcile from the returned `receipt` — persist
  ingestion status and retry the incomplete stage yourself.
- Reuse `ingestion.vectorDocuments` for the vector upsert instead of
  re-embedding. Existing graph registrations are read-only ingestion targets.

## Search tool

```ts
import { createGraphSearchTool } from "@anvia/graph";

const searchGraph = createGraphSearchTool({
  name: "search_graph",
  description: "Search connected entities and supporting evidence.", // required — no default
  graph,
  model: embeddingModel,
  search: { type: "vector", seeds: ["entities"], topK: 8 },
  traversal: {
    relationships: ["AFFECTS"],
    direction: "both",
    maxDepth: 2,
    maxNodes: 40,
    maxRelationships: 80,
  },
  evidence: { type: "chunks", maxChunks: 12 },
});
```

- `search` has two modes: `{ type: "vector", seeds, topK }` and
  `{ type: "hybrid", seeds, topK, candidatesPerSeed, rrfK }` — hybrid fuses
  vector similarity with per-seed graph matches. Prefer it when seed names
  alone miss paraphrased entities.
- Bound everything: `maxDepth`, `maxNodes`, `maxRelationships`, `maxChunks`.
  Unbounded traversal is the graph equivalent of `topK: 1000`.
- Evidence modes depend on the registration: managed graphs hydrate stored
  chunks, existing-graph registrations use `{ type: "none" }`.
- One search tool per question shape, as with vector tools — graph and vector
  tools coexist on the same agent when some questions are relational and some
  are textual.

## Exploration

Adapters implementing `GraphExplorer` expose bounded `overview` / `expand`
views for visualization (Studio's graph explorer, `@anvia/react`
`useGraphExplorer`). Explorer IDs are opaque and provider-specific — follow-up
expansion only, never persistence. Adapters cap requests, return truncation
metadata, and omit stored embeddings and reserved `__anvia_*` properties.
