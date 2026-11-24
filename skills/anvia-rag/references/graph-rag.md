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
      properties: z.object({ id: z.string(), name: z.string() }),
    },
    Incident: {
      description: "An operational incident.",
      identity: ["id"],
      properties: z.object({ id: z.string(), title: z.string() }),
    },
  },
  relationships: {
    AFFECTS: {
      description: "An incident affects a product.",
      from: "Incident",
      to: "Product",
      properties: z.object({ severity: z.enum(["low", "medium", "high"]) }),
    },
  },
});
```

Design the schema from the questions, not the source tables. `identity` fields
are how facts merge — wrong identity modeling duplicates entities forever.
Plain `z.object()` schemas are automatically tightened to strict objects;
`relationships` and relationship `properties` can be omitted when empty.

## Ingestion

```ts
import { ingestGraphText } from "@anvia/graph";

const ingestion = await ingestGraphText({
  graph,
  document: { id: "incident-42", text, metadata: { tenant: "acme" } },
  extractionModel,
  embeddingModel,
  chunking: { maxSize: 1_000, overlap: 100 },
  factConflicts: {
    entity: { properties: { summary: "prefer-longest", aliases: "union", confidence: "max" } },
  },
});
```

- Managed graphs accept the same raw-text shape as vector ingestion, so reuse
  your chunking settings. `conflict` defaults to `"overwrite"` and
  `orphanEntities` defaults to `"delete"` (pass explicit overrides when needed).
  `ingestGraphDocuments()` batches; `ingestGraphTextToStores()` writes graph +
  vector store in one call; `createKnowledgeGraph()` binds models and defaults
  for repeated `ingest()`, `retrieve()`, `asTool()`, and `asContext()` calls.
- Two conflict policies: `factConflicts` (disagreements between chunks, rejected
  by default — strategies like `prefer-longest`, `union`, `max`), and `conflict`
  (collisions with already-stored facts). Set `onInvalidFact: "warn"` to skip
  malformed LLM facts with structured warnings instead of aborting a batch.
- Graph and vector writes are separate transactions. On partial failure
  (`GraphIngestionStageError`) reconcile from the returned `receipt` — persist
  ingestion status and retry the incomplete stage yourself.
- Reuse `ingestion.vectorDocuments` for the vector upsert instead of
  re-embedding. Existing graph registrations are read-only ingestion targets.

## Search tool & agent context

```ts
import { createGraphContext, createGraphSearchTool, formatGraphContext } from "@anvia/graph";

const searchGraph = createGraphSearchTool({
  name: "search_graph",
  description: "Search connected entities and supporting evidence.",
  graph,
  model: embeddingModel,
  format: formatGraphContext, // optional concise text output for LLMs
});

// Or attach directly to Agent.context:
const graphContext = createGraphContext({ graph, model: embeddingModel });
```

- `search`, `traversal`, and `evidence` all default to safe bounded limits
  (vector search `topK: 8`, all schema relationships, `maxDepth: 2`,
  `maxNodes: 40`, `maxRelationships: 80`, chunk evidence `maxChunks: 12` on
  managed graphs). Override any bound explicitly as needed.
- `search` supports `{ type: "vector", seeds?, topK?, minScore? }` and
  `{ type: "hybrid", seeds?, topK?, candidatesPerSeed?, rrfK? }` (default
  `rrfK: 60`).
- Evidence modes depend on the registration: managed graphs hydrate stored
  chunks by default, existing-graph registrations default to `{ type: "none" }`.
- One search tool per question shape, as with vector tools — graph and vector
  tools coexist on the same agent when some questions are relational and some
  are textual.

## Exploration

Adapters implementing `GraphExplorer` expose bounded `overview` / `expand`
views for visualization (Studio's graph explorer, `@anvia/react`
`useGraphExplorer`). Explorer IDs are opaque and provider-specific — follow-up
expansion only, never persistence. Adapters cap requests, return truncation
metadata, and omit stored embeddings and reserved `__anvia_*` properties.
