---
title: "@anvia/langfuse: Overview"
description: "Langfuse tracing, score publishing, dataset, prompt, redaction, and eval reporter adapter for Anvia."
section: packages
sidebar:
  group: "@anvia/langfuse"
  order: 1
  label: "Overview"
---
## What it is

Langfuse tracing, score publishing, dataset, prompt, redaction, and eval reporter adapter for Anvia.

Use @anvia/langfuse when the application needs agent traces, eval scores, prompt metadata, and Langfuse datasets from Anvia runs. It is one of the adapters that make Anvia runs visible in existing telemetry systems.

## Where it fits

`@anvia/langfuse` attaches through `AgentBuilder.observe(...)` and can also publish eval scores, prompts, datasets, and experiment runs through Langfuse APIs.

The package owns Langfuse observer, score, dataset, prompt, redaction, and eval-reporting integration. Keep trace naming, data retention, privacy policy, and production Langfuse project configuration in application code.

## Public surface

The main documented exports are `LangfuseTracingOptions`, `LangfuseTracing`, `LangfuseTraceHandle`, `LangfuseScoreArgs`, `LangfuseScoreError`, `langfuse`. The reference page lists the package entrypoint and public symbols that are checked by the docs reference coverage script.

## Next pages

- [Getting Started](/docs/packages/langfuse/getting-started)
- [Usage Patterns](/docs/packages/langfuse/usage-patterns)
- [Examples](/docs/packages/langfuse/examples)
- [Changelog](/docs/packages/langfuse/changelog)
- [Reference](/docs/packages/langfuse/reference)
