---
title: Examples
description: Common Anvia application patterns, organized by what you want to build.
section: examples
sidebar:
  group: Start Here
  order: 0
---

Examples show common Anvia application shapes. They are not tiny API snippets and they are not long tutorials. Each page should answer a build question: "If I want to build this kind of agent, ingestion flow, tool boundary, or production loop, what does the Anvia shape look like?"

The examples use concrete defaults where a full flow is easier to understand with real adapters: OpenAI `gpt-5.5` for support model examples, Anthropic `claude-opus-4.8` for escalation or judge examples, Mistral OCR for scanned documents, OpenAI `text-embedding-3-small` for embeddings, and Chroma for the primary vector store.

## Build Goals

| If you want to build... | Start with | Then add |
| --- | --- | --- |
| An agent endpoint with auth, history, tools, traces, and persistence | [Agent App Flow](/docs/examples/agent-app-flow) | [Runtime State and Persistence](/docs/examples/runtime-state-persistence) |
| An agent runtime assembled from model, instructions, tools, context, memory, and observers | [Agent Runtime Composition](/docs/examples/agent-runtime-composition) | [Context Assembly](/docs/examples/context-assembly) |
| Tools that enforce user, tenant, and action permissions | [Permissioned Tools](/docs/examples/permissioned-tools) | [Tool Validation](/docs/examples/tool-validation), [Guarded Side Effects](/docs/examples/guarded-side-effects) |
| Typed model output for classification, extraction, or workflow results | [Structured Results](/docs/examples/structured-results) | [Testing Harness](/docs/examples/testing-harness) |
| RAG over PDFs, images, documents, and product knowledge | [RAG Ingestion](/docs/examples/rag-ingestion) | [Retrieval Agent](/docs/examples/retrieval-agent), [Document Grounding](/docs/examples/document-grounding) |
| A support agent with account tools and policy evidence | [Support Agent](/docs/examples/support-agent) | [Permissioned Tools](/docs/examples/permissioned-tools), [Retrieval Agent](/docs/examples/retrieval-agent) |
| A background document or research workflow | [Pipeline Worker](/docs/examples/pipeline-worker) | [Long-running Jobs](/docs/examples/long-running-jobs), [Eval Loop](/docs/examples/eval-loop) |
| A coding or file agent with command boundaries | [Coding Agent](/docs/examples/coding-agent) | [Sandbox Execution](/docs/examples/sandbox-execution) |
| A workflow that needs human approval before writes | [Guarded Side Effects](/docs/examples/guarded-side-effects) | [Human Input](/docs/examples/human-input) |
| A production feedback loop for traces, events, tests, and evals | [Runtime State and Persistence](/docs/examples/runtime-state-persistence) | [Observability Loop](/docs/examples/observability-loop), [Production Readiness](/docs/examples/production-readiness) |

## Common Flows

Agent applications usually start with [Agent App Flow](/docs/examples/agent-app-flow): a thin route or job calls a runner, the runner resolves product state, the agent runs with scoped tools and context, and the application persists the result.

Knowledge applications usually combine [RAG Ingestion](/docs/examples/rag-ingestion), [Retrieval Agent](/docs/examples/retrieval-agent), and [Document Grounding](/docs/examples/document-grounding). The important flow is source documents to OCR or text extraction, chunks, embeddings, Chroma-backed vector index, dynamic context or retrieval tools, then cited answers.

Action-taking applications usually combine [Permissioned Tools](/docs/examples/permissioned-tools), [Tool Validation](/docs/examples/tool-validation), [Guarded Side Effects](/docs/examples/guarded-side-effects), and [Human Input](/docs/examples/human-input). The model can request work, but application code owns permissions, approval, idempotency, audit, and safe output.

Production applications usually add [Runtime State and Persistence](/docs/examples/runtime-state-persistence), [Testing Harness](/docs/examples/testing-harness), [Observability Loop](/docs/examples/observability-loop), [Eval Loop](/docs/examples/eval-loop), and [Production Readiness](/docs/examples/production-readiness).

## More Maps

- [Capability Map](/docs/examples/capability-map) maps Anvia features to the examples that use them.
- [Example Anatomy](/docs/examples/example-anatomy) explains the format each example should follow.
