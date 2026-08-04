---
title: "@anvia/grok: Overview"
description: "Grok provider adapter for completions, live search, server tools, batch speech, image generation, and model listing."
section: packages
sidebar:
  group: "@anvia/grok"
  order: 1
  label: "Overview"
---
## What it is

Grok provider adapter for xAI completions, live search, server-executed tools, batch speech, image generation, and model listing.

Use @anvia/grok when the application needs xAI Grok models behind Anvia agents, completions, pipelines, or extraction flows. It is one of the provider adapters that turn provider SDKs into Anvia model contracts.

## Where it fits

@anvia/grok plugs into `@anvia/core` by returning completion and related model objects from `GrokClient`. Build agents, extractors, and pipelines against the Anvia model interfaces so provider-specific details stay at the model selection boundary.

The package owns mapping Anvia completion, image generation, audio generation, transcription, and listing contracts to xAI APIs. It also exposes typed server-executed tools for the Responses adapter. Keep prompt policy, document ingestion, credential management, and provider fallback decisions in application code.

## Public surface

The main documented exports are `GrokClient`, `GrokResponsesCompletionModel`, `GrokChatCompletionModel`, `GrokImageGenerationModel`, `GrokAudioGenerationModel`, `GrokTranscriptionModel`, `tools`, model constants, and the `grok` namespace. The reference page lists the package entrypoint and public symbols that are checked by the docs reference coverage script.

## Next pages

- [Getting Started](/docs/packages/grok/getting-started)
- [Usage Patterns](/docs/packages/grok/usage-patterns)
- [Examples](/docs/packages/grok/examples)
- [Changelog](/docs/packages/grok/changelog)
- [Reference](/docs/packages/grok/reference)