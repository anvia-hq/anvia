---
title: "@anvia/core: Overview"
description: "Core runtime primitives for agents, tools, completions, extraction, pipelines, retrieval, streaming, MCP, skills, memory, and observability."
section: packages
sidebar:
  group: "@anvia/core"
  order: 1
  label: "Overview"
---
## What it is

Core runtime primitives for agents, tools, completions, extraction, pipelines, retrieval, streaming, MCP, skills, memory, and observability.

Use @anvia/core when the application needs provider-neutral runtime primitives before choosing any specific model provider. It is one of the runtime packages that sit closest to application request handling.

## Where it fits

`@anvia/core` is the center of the package set. Provider packages supply models, storage packages supply indexes, and app packages add transport or UI around the core runtime.

The package owns provider-neutral runtime contracts and orchestration primitives. Keep provider credentials, product data access, persistence policy, and deployment wiring in application code.

## Public surface

The main documented exports are `Import Paths`, `Root Export Notes`. The reference page lists the package entrypoint and public symbols that are checked by the docs reference coverage script.

## Next pages

- [Getting Started](/docs/packages/core/getting-started)
- [Usage Patterns](/docs/packages/core/usage-patterns)
- [Examples](/docs/packages/core/examples)
- [Changelog](/docs/packages/core/changelog)
- [Reference](/docs/packages/core/reference)
