---
title: "@anvia/otel: Overview"
description: "OpenTelemetry tracing adapter for Anvia agent observer events."
section: packages
sidebar:
  group: "@anvia/otel"
  order: 1
  label: "Overview"
---
## What it is

OpenTelemetry tracing adapter for Anvia agent observer events.

Use @anvia/otel when the application needs Anvia run events emitted into an existing OpenTelemetry pipeline. It is one of the adapters that make Anvia runs visible in existing telemetry systems.

## Where it fits

`@anvia/otel` attaches through `AgentBuilder.observe(...)` and uses the application OpenTelemetry SDK or global tracer provider.

The package owns conversion from Anvia observer events to OpenTelemetry spans. Keep SDK startup, exporters, sampling, resource attributes, and process shutdown in application code.

## Public surface

The main documented exports are `OtelTracingOptions`, `OtelTracing`, `otel`. The reference page lists the package entrypoint and public symbols that are checked by the docs reference coverage script.

## Next pages

- [Getting Started](/docs/packages/otel/getting-started)
- [Usage Patterns](/docs/packages/otel/usage-patterns)
- [Examples](/docs/packages/otel/examples)
- [Changelog](/docs/packages/otel/changelog)
- [Reference](/docs/packages/otel/reference)
