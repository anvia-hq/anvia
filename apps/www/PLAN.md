# Documentation Information Plan

This plan maps how `apps/www` should serve product documentation for the packages in `packages/`. It is intentionally implementation-oriented so the docs system can be built one piece at a time.

## Goals

- Keep `/docs` useful for people trying to solve a task.
- Give every package in `packages/` a clear product home.
- Make package relationships obvious: runtime, providers, embeddings, vector stores, observability, tools, and UI/client helpers.
- Avoid hand-maintaining package lists in multiple places.
- Let the landing page, package map, and docs share the same product taxonomy.

## Serving Model

Use a two-layer documentation model:

1. Task-first guides
   - These answer "what am I trying to build?"
   - Examples: build an agent, stream responses, add retrieval, expose tools, observe runs.
   - These stay prominent on `/docs`.

2. Package-first references
   - These answer "what does this package do and how do I use it?"
   - Every package gets a standard page.
   - Package pages are grouped into product families.

This keeps the docs approachable while still giving each product a stable reference URL.

## Route Map

### Primary Docs Routes

- `/docs`
  - Landing page for task-oriented documentation.
  - Shows major workflows and high-value starting points.

- `/docs/getting-started`
  - Minimal install path.
  - Should point users to the smallest useful stack, for example core plus one provider.

- `/docs/guides/*`
  - Narrative, task-oriented guides.
  - Best for workflows that span more than one package.

- `/docs/packages`
  - Product catalog generated from package metadata.
  - Groups every package by product family.

- `/docs/packages/:package`
  - Standard package page.
  - Examples: `/docs/packages/core`, `/docs/packages/openai`, `/docs/packages/qdrant`.

- `/docs/compare/*`
  - Decision pages for users choosing between similar adapters.
  - Examples: providers, vector stores, observability adapters.

- `/docs/examples/*`
  - Copyable recipes that combine packages.
  - These should be practical and runnable.

## Product Taxonomy

### Runtime

Core building blocks for creating and running agents.

- `@anvia/core`
- `@anvia/server`
- `@anvia/react`
- `@anvia/logger`

### Model Providers

Adapters that connect external model providers to the runtime.

- `@anvia/openai`
- `@anvia/anthropic`
- `@anvia/gemini`
- `@anvia/mistral`

### Embeddings

Packages that create embeddings for retrieval workflows.

- `@anvia/fastembed`
- `@anvia/transformers`

### Vector Stores

Storage adapters for retrieval and semantic search.

- `@anvia/qdrant`
- `@anvia/pinecone`
- `@anvia/pgvector`
- `@anvia/redis`
- `@anvia/chroma`
- `@anvia/lancedb`
- `@anvia/milvus`
- `@anvia/weaviate`

### Observability

Tracing, run visibility, and production monitoring.

- `@anvia/langfuse`
- `@anvia/otel`

### Tools and Studio

Developer tools, sandboxing, and local workflow surfaces.

- `@anvia/sandbox`
- `@anvia/studio`

## Page Types

### Docs Landing Page

Purpose: route users into the right path quickly.

Recommended sections:

- Start building
- Core concepts
- Common workflows
- Package map
- Examples
- Production checklist

The landing page should stay task-first, not package-first.

### Package Catalog Page

Purpose: show the complete product surface.

Recommended content:

- Product family sections.
- One row or compact card per package.
- Package name, description, install command, stability/status, and primary docs link.
- Quick filters for runtime, providers, retrieval, observability, and tools.

This page should be generated from package metadata where possible.

### Package Detail Page

Purpose: provide a consistent home for each package.

Standard structure:

1. Overview
2. Install
3. Quickstart
4. Configuration
5. API surface
6. Examples
7. Related packages
8. Changelog link

Every package page should answer:

- What is this package for?
- When should I use it?
- What do I install?
- What is the smallest working example?
- What package usually goes with it?
- What production concerns should I know?

### Guide Page

Purpose: teach a workflow across packages.

Standard structure:

1. Goal
2. Required packages
3. Setup
4. Implementation
5. Testing locally
6. Production notes
7. Next steps

Guides should link to package pages, but package pages should not replace guides.

### Compare Page

Purpose: help users choose between similar packages.

Recommended compare pages:

- `/docs/compare/providers`
- `/docs/compare/vector-stores`
- `/docs/compare/embeddings`
- `/docs/compare/observability`

Each compare page should include:

- Decision table.
- Best default recommendation.
- Local development recommendation.
- Production recommendation.
- Tradeoffs.
- Links to relevant package pages.

### Example Page

Purpose: show copyable combinations.

Recommended initial examples:

- `@anvia/core` + `@anvia/openai`
- `@anvia/core` + `@anvia/gemini`
- `@anvia/server` + `@anvia/react`
- `@anvia/core` + `@anvia/fastembed` + `@anvia/qdrant`
- `@anvia/core` + `@anvia/langfuse`
- `@anvia/core` + `@anvia/sandbox`
- `@anvia/studio` local agent debugging

Examples should be short, complete, and biased toward real usage.

## Metadata Model

Use package metadata as the source of truth when possible.

Package data can come from:

- `packages/*/package.json`
- Optional `packages/*/docs.meta.json`
- Optional package README sections if a future parser is added

Suggested `docs.meta.json` shape:

```json
{
  "slug": "openai",
  "family": "model-providers",
  "label": "OpenAI",
  "status": "stable",
  "featured": true,
  "install": "pnpm add @anvia/core @anvia/openai",
  "related": ["core", "server", "react"],
  "examples": ["openai-agent", "streaming-chat"]
}
```

Keep custom metadata small. Do not duplicate package name, version, or description if it already exists in `package.json`.

## Navigation Model

Top-level docs navigation should remain small:

- Start
- Guides
- Packages
- Examples
- Compare

The sidebar can change based on section:

- Guide pages show workflow groups.
- Package pages show package families.
- Compare pages show decision topics.

Search should index guides, package pages, examples, and compare pages.

## Landing Page Integration

The landing page package map should link into docs:

- Runtime chips link to runtime package pages.
- Provider chips link to provider package pages.
- Vector store chips link to vector store package pages.
- Observability and tool chips link to their package pages.

The package map should use the same taxonomy as `/docs/packages`.

## Implementation Phases

### Phase 1: Information Architecture

- Add package taxonomy in `apps/www`.
- Add a generated package catalog route.
- Add placeholder package pages for every package.
- Link landing-page package chips to docs pages.

### Phase 2: Core Package Pages

Build complete package pages for:

- `@anvia/core`
- `@anvia/server`
- `@anvia/react`
- `@anvia/openai`
- `@anvia/gemini`

These are likely the highest-traffic entry points.

### Phase 3: Retrieval and Observability

Build comparison and package pages for:

- Embeddings
- Vector stores
- Langfuse
- OpenTelemetry

Add retrieval recipes that combine embeddings and vector stores.

### Phase 4: Examples

Add runnable examples for the most common product combinations.

Prioritize:

- Basic agent
- Streaming UI
- Retrieval agent
- Traced agent
- Sandboxed tools
- Studio workflow

### Phase 5: Quality Layer

Add:

- Search metadata.
- Previous/next links.
- "Related packages" blocks.
- "Used in this guide" package blocks.
- Production notes.
- Changelog links.

## Content Rules

- Prefer task names over implementation names in guide titles.
- Prefer package names in reference titles.
- Every package page needs one small copyable install command.
- Every guide should list required packages near the top.
- Every compare page should provide a default recommendation.
- Avoid duplicating the same setup instructions across many pages; link to shared setup pages when possible.

## First Pages To Build

1. `/docs/packages`
2. `/docs/packages/core`
3. `/docs/packages/openai`
4. `/docs/packages/server`
5. `/docs/packages/react`
6. `/docs/compare/providers`
7. `/docs/compare/vector-stores`
8. `/docs/examples/streaming-chat`
9. `/docs/examples/retrieval-agent`
10. `/docs/examples/observe-runs`
