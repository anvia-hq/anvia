---
title: "@anvia/server: Usage Patterns"
description: "Common ways to compose @anvia/server with adjacent Anvia packages."
section: packages
sidebar:
  group: "@anvia/server"
  order: 3
  label: "Usage Patterns"
---
## Package boundary

`@anvia/server` owns stream serialization to web `Response` objects. It does not own authentication, route validation, model selection, or agent construction.

## Common composition

- Use `createEventStream(...)` for route handlers that stream agent events.
- Use JSONL with `@anvia/react` transports by default.
- Use SSE when infrastructure or clients require `text/event-stream`.

## Do and do not

Do validate request bodies before starting a model run. Do surface user-safe errors in stream options. Do keep server-only model credentials outside React bundles.

Do not start long model work before auth succeeds. Do not mix unrelated event formats on one endpoint. Do not expose raw stack traces to browser clients.
