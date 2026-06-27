---
title: "@anvia/mistral: Overview"
description: "Mistral provider adapter for completions, embeddings, OCR, and model listing."
section: packages
sidebar:
  group: "@anvia/mistral"
  order: 1
  label: "Overview"
---
## What it is

Mistral provider adapter for completions, embeddings, OCR, and model listing.

Use @anvia/mistral when the application needs Mistral models behind Anvia agents, completions, pipelines, or extraction flows. It is one of the provider adapters that turn provider SDKs into Anvia model contracts.

## Where it fits

@anvia/mistral plugs into `@anvia/core` by returning completion and related model objects from `MistralClient`. Build agents, extractors, and pipelines against the Anvia model interfaces so provider-specific details stay at the model selection boundary.

The package owns mapping Anvia completion, embedding, OCR, and listing contracts to Mistral APIs. Keep prompt policy, document ingestion, credential management, and provider fallback decisions in application code.

## Public surface

The main documented exports are `MistralClient`, `MistralCompletionModel`, `MistralEmbeddingModel`, `MistralOcrModel`, `mistral Namespace`, `Mapping Helpers`. The reference page lists the package entrypoint and public symbols that are checked by the docs reference coverage script.

## Next pages

- [Getting Started](/docs/packages/mistral/getting-started)
- [Usage Patterns](/docs/packages/mistral/usage-patterns)
- [Examples](/docs/packages/mistral/examples)
- [Changelog](/docs/packages/mistral/changelog)
- [Reference](/docs/packages/mistral/reference)
