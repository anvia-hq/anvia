---
title: "@anvia/studio: Overview"
description: "Studio UI and HTTP runtime for Anvia agents, pipelines, tools, MCPs, memory, status, knowledge, and traces."
section: packages
sidebar:
  group: "@anvia/studio"
  order: 1
  label: "Overview"
---
## What it is

Studio UI and HTTP runtime for Anvia agents, pipelines, tools, MCPs, memory, status, knowledge, and traces.

Use @anvia/studio when the application needs a local UI and HTTP runtime around agents, pipelines, tools, memory, traces, and knowledge. It is one of the developer workflow packages for tools, local runtime inspection, and controlled execution.

## Where it fits

`@anvia/studio` wraps agents and pipelines with a local UI and HTTP runtime. It composes with `@anvia/core`, `@anvia/react`, and `@anvia/server` rather than replacing application runtime code.

The package owns local browser UI, HTTP routes, run streaming, session/trace stores, and runtime inspectors. Keep agent definitions, model providers, auth boundary, deployment topology, and production persistence decisions in application code.

## Public surface

The main documented exports are `Public Imports`. The reference page lists the package entrypoint and public symbols that are checked by the docs reference coverage script.

## Next pages

- [Getting Started](/docs/packages/studio/getting-started)
- [Usage Patterns](/docs/packages/studio/usage-patterns)
- [Examples](/docs/packages/studio/examples)
- [Changelog](/docs/packages/studio/changelog)
- [Reference](/docs/packages/studio/reference)
