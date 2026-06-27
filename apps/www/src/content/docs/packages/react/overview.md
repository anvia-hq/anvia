---
title: "@anvia/react: Overview"
description: "React hooks, event transports, and stream readers for Anvia browser clients."
section: packages
sidebar:
  group: "@anvia/react"
  order: 1
  label: "Overview"
---
## What it is

React hooks, event transports, and stream readers for Anvia browser clients.

Use @anvia/react when the application needs a browser UI that consumes Anvia stream events without owning server-side model code. It is one of the runtime packages that sit closest to application request handling.

## Where it fits

`@anvia/react` belongs in the browser. It pairs with an application route, usually implemented with `@anvia/server`, that streams Anvia events.

The package owns client-side chat/completion state and event-stream transport plumbing. Keep server routes, auth, persistence, model selection, and product UI composition in application code.

## Public surface

The main documented exports are `Types`, `EventTransport`, `readJsonlStream`, `readSseStream`, `fetchEventStream`, `createFetchTransport`. The reference page lists the package entrypoint and public symbols that are checked by the docs reference coverage script.

## Next pages

- [Getting Started](/docs/packages/react/getting-started)
- [Usage Patterns](/docs/packages/react/usage-patterns)
- [Examples](/docs/packages/react/examples)
- [Changelog](/docs/packages/react/changelog)
- [Reference](/docs/packages/react/reference)
