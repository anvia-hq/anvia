---
title: "@anvia/gemini: Overview"
description: "Gemini and Vertex AI provider adapter for Anvia completions, embeddings, image generation, transcription, and model listing."
section: packages
sidebar:
  group: "@anvia/gemini"
  order: 1
  label: "Overview"
---
## What it is

Gemini and Vertex AI provider adapter for Anvia completions, embeddings, image generation, transcription, and model listing.

Use @anvia/gemini when the application needs Gemini models behind Anvia agents, completions, pipelines, or extraction flows. It is one of the provider adapters that turn provider SDKs into Anvia model contracts.

## Where it fits

@anvia/gemini plugs into `@anvia/core` by returning completion and related model objects from `GeminiClient`. Build agents, extractors, and pipelines against the Anvia model interfaces so provider-specific details stay at the model selection boundary.

The package owns mapping Anvia contracts to Google GenAI and Vertex AI model calls. Keep project selection, auth mode, prompt policy, tool behavior, and product routing in application code.

## Public surface

The main documented exports are `GeminiClient`, `Multimodal Models`, `GeminiCompletionModel`, `GeminiEmbeddingModel`, `gemini Namespace`. The reference page lists the package entrypoint and public symbols that are checked by the docs reference coverage script.

## Next pages

- [Getting Started](/docs/packages/gemini/getting-started)
- [Usage Patterns](/docs/packages/gemini/usage-patterns)
- [Examples](/docs/packages/gemini/examples)
- [Changelog](/docs/packages/gemini/changelog)
- [Reference](/docs/packages/gemini/reference)
