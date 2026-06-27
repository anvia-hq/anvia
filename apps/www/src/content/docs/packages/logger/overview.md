---
title: "@anvia/logger: Overview"
description: "Structured logger adapters that turn Anvia observer events into application logs."
section: packages
sidebar:
  group: "@anvia/logger"
  order: 1
  label: "Overview"
---
## What it is

Structured logger adapters that turn Anvia observer events into application logs.

Use @anvia/logger when the application needs agent lifecycle events written into a normal application logger. It is one of the runtime packages that sit closest to application request handling.

## Where it fits

`@anvia/logger` attaches through `AgentBuilder.observe(...)`. It consumes observer events emitted by core and writes structured log records through console or Pino adapters.

The package owns console and Pino logger adapters plus an agent observer. Keep log routing, retention, redaction policy, and alerting in application code.

## Public surface

The main documented exports are `Logger`, `LogLevel`, `LogContext`, `LoggerOptions`, `ConsoleLoggerOptions`, `createConsoleLogger`. The reference page lists the package entrypoint and public symbols that are checked by the docs reference coverage script.

## Next pages

- [Getting Started](/docs/packages/logger/getting-started)
- [Usage Patterns](/docs/packages/logger/usage-patterns)
- [Examples](/docs/packages/logger/examples)
- [Changelog](/docs/packages/logger/changelog)
- [Reference](/docs/packages/logger/reference)
