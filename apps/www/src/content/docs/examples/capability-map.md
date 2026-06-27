---
title: Capability Map
description: Map Anvia features to the examples that show them in application flows.
section: examples
sidebar:
  group: Start Here
  order: 1
---

Use this map when you already know which Anvia feature you want to use and need to find the example that places it in an application flow.

The concrete RAG stack used in examples is Mistral OCR, OpenAI embeddings, and Chroma. Treat that as the reference path; provider and store pages show the swappable alternatives.

## Core Runtime

| Capability | Example flow | What the example should prove |
| --- | --- | --- |
| Agents | [Agent App Flow](/docs/examples/agent-app-flow), [Support Agent](/docs/examples/support-agent) | A product request can run through auth, tools, model calls, traces, and persistence. |
| Runtime composition | [Agent Runtime Composition](/docs/examples/agent-runtime-composition) | Model, instructions, tools, context, memory, observers, and output contracts are assembled at the right boundary. |
| Request runners | [Agent App Flow](/docs/examples/agent-app-flow), [Pipeline Worker](/docs/examples/pipeline-worker) | Routes, jobs, and tests call the same workflow function. |
| Memory and sessions | [Context Assembly](/docs/examples/context-assembly), [Runtime State and Persistence](/docs/examples/runtime-state-persistence) | Conversation state is durable without becoming an authorization or audit system. |
| Streaming events | [Streaming Events](/docs/examples/streaming-events) | UIs consume text, tool progress, and final events as workflow state. |
| Event store | [Runtime State and Persistence](/docs/examples/runtime-state-persistence), [Observability Loop](/docs/examples/observability-loop) | Runtime events are replayable for debugging and audit. |

## Tools And Actions

| Capability | Example flow | What the example should prove |
| --- | --- | --- |
| Typed tools | [Permissioned Tools](/docs/examples/permissioned-tools) | Tool schemas describe the model-facing contract while services enforce product permissions. |
| Tool authorization | [Permissioned Tools](/docs/examples/permissioned-tools), [Tool Validation](/docs/examples/tool-validation) | User and tenant scope come from the request, not model arguments. |
| Tool approvals | [Guarded Side Effects](/docs/examples/guarded-side-effects), [Human Input](/docs/examples/human-input) | Sensitive work pauses or routes to a human decision before execution. |
| Tool output safety | [Tool Validation](/docs/examples/tool-validation), [Runtime State and Persistence](/docs/examples/runtime-state-persistence) | Tools return narrow, safe result shapes and keep private records in application storage. |
| Dynamic tool catalogs | [Dynamic Tool Catalogs](/docs/examples/dynamic-tool-catalogs) | Large tool sets are searched and filtered before the model sees them. |
| MCP tools | [MCP Agent](/docs/examples/mcp-agent) | External server tools are filtered and wrapped before joining app-owned tools. |

## Knowledge And Retrieval

| Capability | Example flow | What the example should prove |
| --- | --- | --- |
| OCR | [RAG Ingestion](/docs/examples/rag-ingestion) | Scanned documents can enter the same ingestion pipeline as CMS and PDF text sources. |
| Embeddings | [RAG Ingestion](/docs/examples/rag-ingestion) | Chunks become OpenAI embeddings with stable ids and source metadata. |
| Vector stores | [RAG Ingestion](/docs/examples/rag-ingestion), [Retrieval Agent](/docs/examples/retrieval-agent) | Chroma stores embedded documents while runtime code depends on the vector index contract. |
| Dynamic context | [Retrieval Agent](/docs/examples/retrieval-agent), [Document Grounding](/docs/examples/document-grounding) | Retrieved evidence enters the prompt with filters, thresholds, and source labels. |
| Retrieval tools | [Retrieval Agent](/docs/examples/retrieval-agent), [Research Agent](/docs/examples/research-agent) | The model can request knowledge without bypassing product filters. |
| Citations and evidence logs | [Document Grounding](/docs/examples/document-grounding), [Observability Loop](/docs/examples/observability-loop) | Final answers can be traced back to selected sources. |

## Structured Workflows

| Capability | Example flow | What the example should prove |
| --- | --- | --- |
| Direct parsed completion | [Structured Results](/docs/examples/structured-results) | One model call returns validated application data. |
| Agent final output schema | [Structured Results](/docs/examples/structured-results), [Support Agent](/docs/examples/support-agent) | A tool-using agent can end with a typed result. |
| Extractors | [Structured Results](/docs/examples/structured-results), [RAG Ingestion](/docs/examples/rag-ingestion) | Existing text can be converted into schema-validated records. |
| Pipelines | [Pipeline Worker](/docs/examples/pipeline-worker), [Long-running Jobs](/docs/examples/long-running-jobs) | Multi-step work runs outside the request path with status and retry policy. |

## Production

| Capability | Example flow | What the example should prove |
| --- | --- | --- |
| Tests | [Testing Harness](/docs/examples/testing-harness) | Deterministic boundaries are testable without relying on live model behavior. |
| Traces and observers | [Observability Loop](/docs/examples/observability-loop), [Runtime State and Persistence](/docs/examples/runtime-state-persistence) | A run can be debugged from request id to model events and tool calls. |
| Evals | [Eval Loop](/docs/examples/eval-loop) | Expected product behavior becomes repeatable regression coverage. |
| Provider switching | [Provider Switching](/docs/examples/provider-switching) | Model selection changes at the runtime boundary, not throughout product code. |
| Launch review | [Production Readiness](/docs/examples/production-readiness) | The workflow has permission, privacy, retry, audit, and operational checks. |
