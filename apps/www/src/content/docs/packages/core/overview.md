---
title: "@anvia/core: Overview"
description: "Small, explicit, embeddable runtime contracts for agents, tools, completions, extraction, pipelines, retrieval, streaming, MCP, skills, memory, and observability."
section: packages
sidebar:
  group: "@anvia/core"
  order: 1
  label: "Overview"
---
## What it is

Small, explicit, embeddable runtime contracts for agents, tools, completions, extraction,
pipelines, retrieval, streaming, MCP, skills, memory, and observability.

Use @anvia/core when the application needs provider-neutral runtime behavior without
handing product architecture to the runtime. The app creates provider clients and model
objects, memory stores, service-backed tools, vector indexes, observers, and transports.
Core receives those objects and runs the model/tool loop around them.

## Where it fits

`@anvia/core` is the center of the package set. Provider packages supply models, storage packages supply indexes, and app packages add transport or UI around the core runtime.

The package owns provider-neutral runtime contracts and orchestration primitives. Keep
provider credentials, product data access, memory and persistence policy, observability
backends, and deployment wiring in application code. In practice, Anvia should be
dependency-injection oriented: construct the dependencies your product owns, then pass
them into agents, prompt requests, tools, runners, or adapters.

## Public surface

The main documented exports are `Import Paths`, `Root Export Notes`. The reference page lists the package entrypoint and public symbols that are checked by the docs reference coverage script.

## Next pages

- [Getting Started](/docs/packages/core/getting-started)
- [Usage Patterns](/docs/packages/core/usage-patterns)
- [Examples](/docs/packages/core/examples)
- [Changelog](/docs/packages/core/changelog)
- [Reference](/docs/packages/core/reference)
