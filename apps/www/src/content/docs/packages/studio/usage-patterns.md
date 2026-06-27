---
title: "@anvia/studio: Usage Patterns"
description: "Common ways to compose @anvia/studio with adjacent Anvia packages."
section: packages
sidebar:
  group: "@anvia/studio"
  order: 3
  label: "Usage Patterns"
---
## Package boundary

`@anvia/studio` owns the local UI and HTTP runtime around agents and pipelines. Application code owns the agents, models, tools, auth boundary, and whether Studio is exposed beyond local development.

## Common composition

- Serve agents or pipelines with `new Studio([...targets]).start(...)`.
- Add model catalog metadata when the UI should let users select allowed models.
- Add SQLite stores when sessions and traces should persist beyond process lifetime.

## Do and do not

Do use Studio to inspect tools, memory, traces, knowledge, and pipeline runs during development. Do configure allowed models per agent when exposing multiple providers. Do keep the default in-memory store for disposable local sessions.

Do not expose Studio publicly without an application-level access boundary. Do not treat Studio stores as your product database.
