---
title: "@anvia/otel: Usage Patterns"
description: "Common ways to compose @anvia/otel with adjacent Anvia packages."
section: packages
sidebar:
  group: "@anvia/otel"
  order: 3
  label: "Usage Patterns"
---
## Package boundary

`@anvia/otel` owns span creation from Anvia observer events. The application owns OpenTelemetry SDK setup, exporters, resource attributes, sampling, and shutdown.

## Common composition

- Attach `otel.create(...)` through `AgentBuilder.observe(...)`.
- Use the same SDK/exporter setup as the rest of the service.
- Pair with logs when run-level debugging needs both structured events and traces.

## Do and do not

Do start the OpenTelemetry SDK before agents run. Do use stable service and deployment attributes. Do sample intentionally for high-volume workloads.

Do not expect this package to start or flush the SDK. Do not put raw secrets in span attributes.
