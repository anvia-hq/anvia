# Anvia Cookbook

The cookbook is the runnable learning path for the Anvia SDK. Each section adds one SDK concept at a time, moving from core agent calls to tools, structured output, pipelines, retrieval, multimodal APIs, multi-agent workflows, evals, Studio, and external integrations.

Run examples from the repository root:

```sh
pnpm cookbook:basics:01
```

Or from this directory:

```sh
pnpm basics:01
```

Legacy script names such as `cookbook:basic:01`, `cookbook:intermediate:14`, `cookbook:pipeline:04`, `cookbook:rag:05`, and `cookbook:multimodal:03` remain as aliases.

## Learning Path

| Section | Focus |
| --- | --- |
| `01_basics` | First text calls, memory-backed conversation context, static context, streaming, HTTP stream transports, `ReadableStream` output, and durable session memory. |
| `02_tools` | Tool schemas, streamed tool events, hooks, concurrency, conditional tools, think tools, application state, memory with tools, guarded tools, dynamic tool selection, Docker sandbox tools, and visible browser agents. |
| `03_structured_output` | Schema-first extraction, agent output schemas, context, retries, and extraction with prior messages. |
| `04_providers_and_multimodal` | Provider adapters, model capabilities, model listing, reasoning streams, image/PDF attachments, image generation, audio generation, and transcription. |
| `05_pipelines` | Step transforms, async steps, composition, named parallel branches, batching, agents, extractors, and richer workflows. |
| `06_retrieval` | Embeddings, in-memory search, metadata filters, RAG context, document chunking and PDF extraction, vector stores, GraphRAG, and embedding provider variants. |
| `07_multi_agent` | Basic agent-tools, pipeline-backed parallel specialists, and streaming agent-tools. |
| `08_evals` | Deterministic metrics, semantic similarity, custom metrics, agent eval targets, LLM judges, RAG quality, G-Eval, and conversational evals. |
| `09_studio` | Single-agent, multi-agent, pipeline, eval, and subagent Studio runners, pipeline replay, realtime observability, tool approvals, human feedback, Knowledge, Memory, Status, tool and sandbox inspection, embedded browser desktops, MCP tools, SQLite persistence, multi-provider model selection, and UI route options. |
| `10_integrations` | MCP tools, local skills, Langfuse and OpenTelemetry tracing, logging, and correlated eval reporting. |

## Environment

Create a repository-root `.env` for examples that call provider APIs:

```sh
OPENAI_API_KEY=...
OPENAI_BASEURL=...
ANTHROPIC_API_KEY=...
ANTHROPIC_BASEURL=...
GEMINI_API_KEY=...
MISTRAL_API_KEY=...
XAI_API_KEY=...
LANGFUSE_PUBLIC_KEY=...
LANGFUSE_SECRET_KEY=...
LANGFUSE_BASE_URL=https://cloud.langfuse.com
LANGFUSE_TRACING_ENVIRONMENT=development
LANGFUSE_RELEASE=0.0.0
LANGFUSE_SERVICE_NAME=cookbook
DATABASE_URL=...
PINECONE_API_KEY=...
PINECONE_INDEX_NAME=...
PINECONE_NAMESPACE=...
```

Not every example needs every variable. Pure pipeline, dynamic tool, and core eval examples run without provider credentials.

## External Services and Side Effects

- Chroma, Qdrant, pgvector, Milvus, and Neo4j examples use `compose.cookbook.yml` from the cookbook directory:

  ```sh
  docker compose -f examples/cookbook/compose.cookbook.yml up -d
  pnpm cookbook:retrieval:05
  pnpm cookbook:retrieval:06
  pnpm cookbook:retrieval:07
  pnpm cookbook:retrieval:08
  pnpm cookbook:retrieval:12
  pnpm cookbook:retrieval:14
  ```

- `retrieval:08` uses the compose pgvector connection on host port `5439` by default. Set `DATABASE_URL` to point it at another Postgres database.
- `retrieval:13` uses a hosted Pinecone index. Create a 384-dimension index first, then set `PINECONE_API_KEY`, `PINECONE_INDEX_NAME`, and optionally `PINECONE_NAMESPACE`.
- `retrieval:14` requires Neo4j 2026.01 or newer. It explicitly extracts graph facts, embeds chunks and entities, replaces document-scoped graph state, and exposes bounded graph retrieval as an Agent tool.
- Langfuse examples need Langfuse credentials and live in `10_integrations`.
- `integrations:06` logs agent lifecycle events with Pino through `@anvia/logger`; `integrations:07` shows the built-in console logger.
- Studio examples start a local HTTP server and keep Studio state in memory by default. `studio:10` shows explicit SQLite store wiring for sessions, traces, pipeline logs, and pipeline run history. `studio:13` shows the Studio message-composer model selector across OpenAI and Anthropic. `studio:14` shows MCP tools in Studio. `studio:15` requires Docker and explicitly registers an ephemeral sandbox's read-only inspector, published preview port, and managed processes; Ctrl+C destroys the sandbox.
- Document examples may write sample files under `.memory`.
- Image and audio generation examples write generated media files in the current working directory.
- `providers:09` uses the bundled `assets/audio/voice.wav` sample by default. Set `ANVIA_AUDIO_FILE` to transcribe a different local audio file.
- `tools:11` requires Docker and runs code in an ephemeral `@anvia/sandbox` container workspace.
- `studio:16` requires Docker, a locally available `ANVIA_BROWSER_IMAGE`, and an exactly eight-character `ANVIA_BROWSER_VNC_PASSWORD`. Build `packages/tool-browser/image` or explicitly pull a published image first. The example connects browser tools to an Agent; matching tool calls open Studio's clean noVNC Playground panel automatically, with explicit human takeover when needed.

## Representative No-Network Checks

```sh
pnpm --filter cookbook typecheck
pnpm --filter cookbook pipelines:01
pnpm --filter cookbook tools:09
pnpm --filter cookbook evals:01
```
