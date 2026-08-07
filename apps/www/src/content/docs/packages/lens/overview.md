---
title: "@anvia/lens: Overview"
description: "Native Anvia Lens tracing and evaluation reporting for Node.js."
section: packages
sidebar:
  group: "@anvia/lens"
  order: 1
  label: "Overview"
---
## What it is

`@anvia/lens` is the native connection between Anvia agents and Anvia Lens. It exports agent traces
and correlated evaluation results over OTLP HTTP with project-scoped Lens credentials.

Unlike `@anvia/langfuse`, which targets any Langfuse-compatible backend, this package can evolve
with Lens-specific product concepts. Version 1 focuses on traces, run events, prompt references,
release and environment context, and evaluation results.

## Runtime ownership

`lens.create()` owns isolated OpenTelemetry trace and log providers. It does not register global
providers or export unrelated application telemetry. Safe capture is enabled by default.

## Next pages

- [Getting Started](/docs/packages/lens/getting-started)
- [Usage Patterns](/docs/packages/lens/usage-patterns)
- [Examples](/docs/packages/lens/examples)
- [Reference](/docs/packages/lens/reference)
