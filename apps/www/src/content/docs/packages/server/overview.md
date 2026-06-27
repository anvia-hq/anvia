---
title: "@anvia/server: Overview"
description: "Server-side stream helpers for returning Anvia run events as JSONL or Server-Sent Events."
section: packages
sidebar:
  group: "@anvia/server"
  order: 1
  label: "Overview"
---
## What it is

Server-side stream helpers for returning Anvia run events as JSONL or Server-Sent Events.

Use @anvia/server when the application needs agent or completion stream events returned from a server route. It is one of the runtime packages that sit closest to application request handling.

## Where it fits

`@anvia/server` belongs at the HTTP boundary. It receives an async iterable of Anvia events and returns a streaming `Response` in JSONL or SSE format.

The package owns HTTP Response and ReadableStream conversion for event streams. Keep route authentication, rate limits, request validation, and agent construction in application code.

## Public surface

The main documented exports are `Types`, `createEventStream`, `createJsonlStream`, `createSseStream`. The reference page lists the package entrypoint and public symbols that are checked by the docs reference coverage script.

## Next pages

- [Getting Started](/docs/packages/server/getting-started)
- [Usage Patterns](/docs/packages/server/usage-patterns)
- [Examples](/docs/packages/server/examples)
- [Changelog](/docs/packages/server/changelog)
- [Reference](/docs/packages/server/reference)
