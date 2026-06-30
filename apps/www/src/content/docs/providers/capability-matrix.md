---
title: Capability matrix
description: Compare the current Anvia provider adapters by exposed runtime capability.
section: providers
sidebar:
  group: Getting started
  order: 2
---

This matrix describes what each Anvia provider adapter exposes today. It is adapter-level truth, not a guarantee that every upstream model id supports every capability.

Always smoke test the exact provider model id, account, region, endpoint, and `additionalParams` your workflow will use.

## Completion Capabilities

| Capability | OpenAI | Anthropic | Gemini | Mistral | Grok |
| --- | --- | --- | --- | --- | --- |
| Text completion | yes | yes | yes | yes | yes |
| Streaming completion | yes | yes | yes | yes | yes |
| Tools | yes | yes | yes | yes | yes |
| Tool choice | yes | yes | yes | yes | yes |
| Structured output schema | yes | no | yes | yes | yes |
| Chat image input | yes | yes | yes | no | yes |
| Chat document file input | Responses yes, Chat adapter no | yes | yes | no | Responses yes, Chat adapter no |
| Reasoning content | yes | yes | yes | no | yes |

OpenAI has two completion adapters. `OpenAIResponsesCompletionModel` is the default for normal OpenAI API usage. `OpenAIChatCompletionModel` is available when a workflow needs the chat-completions adapter.
Grok also exposes Responses and Chat adapters; Responses is the default.

Text document content and static context can still be represented as text. The document row above is about file or URL document attachments that require provider-native document input support.

## Non-Completion Capabilities

| Capability | OpenAI | Anthropic | Gemini | Mistral | Grok |
| --- | --- | --- | --- | --- | --- |
| Embeddings | yes | no | yes | yes | no |
| Image generation | yes | no | yes | no | yes |
| Audio generation | yes | no | no | no | no |
| Transcription | yes | no | yes | no | no |
| OCR | no | no | no | yes | no |
| Model listing | yes | yes | yes | yes | yes |

Provider-specific model factories return objects that implement core contracts such as `EmbeddingModel`, `ImageGenerationModel`, `AudioGenerationModel`, `TranscriptionModel`, or `ModelListingClient`.

## Compatible API Guides

| Guide | Endpoint option | Notes |
| --- | --- | --- |
| [OpenAI-Compatible](/docs/providers/openai-compatible) | `baseUrl` | Defaults to the chat-completions adapter when set. Use `completionApi` to force `"responses"` or `"chat"`. |
| [Anthropic-Compatible](/docs/providers/anthropic-compatible) | `baseUrl` | Use for Anthropic-compatible APIs. |

Compatible APIs need extra capability checks. A compatible API can share an HTTP shape while differing in tools, tool choice, schemas, reasoning fields, streaming chunks, or media support.

## Practical Selection

Use the matrix to choose candidates, then prove the workflow with tests:

- direct completion for credentials and basic request mapping
- streaming completion if UI progress matters
- forced or required tool calls if tools are enabled
- parsed completion if structured output is required
- sample image, audio, transcription, embedding, or OCR requests for media workflows
- model listing only for inventory, not capability proof

Read [Testing strategy](/docs/advanced/testing-strategy) for provider smoke tests and [Model listing](/docs/advanced/model-listing) for inventory behavior.
