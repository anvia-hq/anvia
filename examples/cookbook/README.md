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
| `01_basics` | First text calls, explicit transcripts, static context, streaming, HTTP stream transports, `ReadableStream` output, and durable session memory. |
| `02_tools` | Tool schemas, streamed tool events, hooks, concurrency, conditional tools, think tools, application state, history with tools, guarded tools, dynamic tool selection, and Docker sandbox tools. |
| `03_structured_output` | Schema-first extraction, agent output schemas, context, retries, and extraction with prior messages. |
| `04_providers_and_multimodal` | Provider adapters, model capabilities, model listing, reasoning streams, image/PDF attachments, image generation, audio generation, and transcription. |
| `05_pipelines` | Step transforms, async steps, composition, named parallel branches, batching, agents, extractors, and richer workflows. |
| `06_retrieval` | Embeddings, in-memory search, metadata filters, RAG context, document loaders, vector stores, and embedding provider variants. |
| `07_multi_agent` | Basic agent-tools, pipeline-backed parallel specialists, streaming agent-tools, and event stores. |
| `08_evals` | Deterministic metrics, semantic similarity, custom metrics, agent eval targets, and LLM judge/score. |
| `09_studio` | Single-agent, multi-agent, pipeline, eval, and subagent Studio runners, pipeline replay, realtime observability, tool approvals, human feedback, Knowledge, Memory, Status, tool inspection, SQLite persistence, and UI route options. |
| `10_integrations` | MCP tools, local skills, Langfuse tracing, logging, and eval reporting. |

## Environment

Create a repository-root `.env` for examples that call provider APIs:

```sh
OPENAI_API_KEY=...
OPENAI_BASEURL=...
ANTHROPIC_API_KEY=...
ANTHROPIC_BASEURL=...
GEMINI_API_KEY=...
MISTRAL_API_KEY=...
LANGFUSE_PUBLIC_KEY=...
LANGFUSE_SECRET_KEY=...
LANGFUSE_BASE_URL=...
DATABASE_URL=...
PINECONE_API_KEY=...
PINECONE_INDEX_NAME=...
PINECONE_NAMESPACE=...
```

Not every example needs every variable. Pure pipeline, dynamic tool, and core eval examples run without provider credentials.

## External Services and Side Effects

- Chroma, Qdrant, pgvector, and Milvus examples use `compose.cookbook.yml` from the cookbook directory:

  ```sh
  docker compose -f examples/cookbook/compose.cookbook.yml up -d
  pnpm cookbook:retrieval:05
  pnpm cookbook:retrieval:06
  pnpm cookbook:retrieval:07
  pnpm cookbook:retrieval:08
  pnpm cookbook:retrieval:12
  ```

- `retrieval:08` uses the compose pgvector connection on host port `5439` by default. Set `DATABASE_URL` to point it at another Postgres database.
- `retrieval:13` uses a hosted Pinecone index. Create a 384-dimension index first, then set `PINECONE_API_KEY`, `PINECONE_INDEX_NAME`, and optionally `PINECONE_NAMESPACE`.
- Langfuse examples need Langfuse credentials and live in `10_integrations`.
- `integrations:06` logs agent lifecycle events with Pino through `@anvia/logger`; `integrations:07` shows the built-in console logger.
- Studio examples start a local HTTP server and keep Studio state in memory by default. `studio:10` shows explicit SQLite store wiring for sessions, traces, pipeline logs, and pipeline run history.
- Tool history and loader examples write sample files under `.memory`.
- Image and audio generation examples write generated media files in the current working directory.
- `providers:09` uses the bundled `assets/audio/voice.wav` sample by default. Set `ANVIA_AUDIO_FILE` to transcribe a different local audio file.
- `tools:11` requires Docker and runs code in an ephemeral `@anvia/sandbox` container workspace.

## Representative No-Network Checks

```sh
pnpm --filter cookbook typecheck
pnpm --filter cookbook pipelines:01
pnpm --filter cookbook tools:09
pnpm --filter cookbook evals:01
```
