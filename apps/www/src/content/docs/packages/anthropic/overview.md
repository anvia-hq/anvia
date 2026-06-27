---
title: "@anvia/anthropic: Overview"
description: "Anthropic provider adapter for Anvia completion models and streaming Messages API responses."
section: packages
sidebar:
  group: "@anvia/anthropic"
  order: 1
  label: "Overview"
---
## What it is

Anthropic provider adapter for Anvia completion models and streaming Messages API responses.

Use @anvia/anthropic when the application needs Anthropic models behind Anvia agents, completions, pipelines, or extraction flows. It is one of the provider adapters that turn provider SDKs into Anvia model contracts.

## Where it fits

@anvia/anthropic plugs into `@anvia/core` by returning completion and related model objects from `AnthropicClient`. Build agents, extractors, and pipelines against the Anvia model interfaces so provider-specific details stay at the model selection boundary.

The package owns mapping Anvia completion requests, tools, multimodal content, and stream events to Anthropic Messages. Keep prompt policy, tool behavior, credential management, and provider fallback decisions in application code.

## Public surface

The main documented exports are `AnthropicClient`, `AnthropicCompletionModel`, `Helper Namespaces`. The reference page lists the package entrypoint and public symbols that are checked by the docs reference coverage script.

## Next pages

- [Getting Started](/docs/packages/anthropic/getting-started)
- [Usage Patterns](/docs/packages/anthropic/usage-patterns)
- [Examples](/docs/packages/anthropic/examples)
- [Changelog](/docs/packages/anthropic/changelog)
- [Reference](/docs/packages/anthropic/reference)
