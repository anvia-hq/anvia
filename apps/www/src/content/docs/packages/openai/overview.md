---
title: "@anvia/openai: Overview"
description: "OpenAI provider adapter for Anvia completions, embeddings, image generation, audio generation, transcription, model listing, and OpenAI-compatible endpoints."
section: packages
sidebar:
  group: "@anvia/openai"
  order: 1
  label: "Overview"
---
## What it is

OpenAI provider adapter for Anvia completions, embeddings, image generation, audio generation, transcription, model listing, and OpenAI-compatible endpoints.

Use @anvia/openai when the application needs OpenAI models behind Anvia agents, completions, pipelines, or extraction flows. It is one of the provider adapters that turn provider SDKs into Anvia model contracts.

## Where it fits

@anvia/openai plugs into `@anvia/core` by returning completion and related model objects from `OpenAIClient`. Build agents, extractors, and pipelines against the Anvia model interfaces so provider-specific details stay at the model selection boundary.

The package owns mapping Anvia model contracts onto OpenAI SDK requests and responses. Keep prompt policy, tool definitions, tenant routing, key storage, and provider fallback decisions in application code.

## Public surface

The main documented exports are `OpenAIClient`, `Multimodal Models`, `OpenAIEmbeddingModel`, `OpenAIResponsesCompletionModel`, `OpenAIChatCompletionModel`, `Helper Namespaces`. The reference page lists the package entrypoint and public symbols that are checked by the docs reference coverage script.

## Next pages

- [Getting Started](/docs/packages/openai/getting-started)
- [Usage Patterns](/docs/packages/openai/usage-patterns)
- [Examples](/docs/packages/openai/examples)
- [Changelog](/docs/packages/openai/changelog)
- [Reference](/docs/packages/openai/reference)
