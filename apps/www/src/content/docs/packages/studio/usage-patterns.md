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
- Attach tools from `createSandboxTools(...)` to expose their live workspace in the Sandboxes
  inspector automatically.

## Inspect sandbox workspaces

Studio detects the live `SandboxSession` attached to tools created by `@anvia/sandbox`. When at
least one configured agent uses those tools, Studio enables its Sandboxes page and read-only
`/sandboxes` API without additional registration:

```ts
const session = await DockerSandbox.node().createSession();
const agent = new AgentBuilder("builder", model).tools(createSandboxTools(session)).build();

new Studio([agent]).start();
```

The inspector can browse files and, when supported by the session, view published ports, managed
processes, and process logs. It never starts, stops, writes to, or destroys a sandbox. Discovery is
limited to the exact live sessions attached to configured agent tools; Studio does not scan Docker
or take ownership of their lifecycle.

Sandbox contents are live and are not persisted by Studio. Treat these routes as privileged
development access and place an application-level access boundary in front of Studio whenever it
is reachable beyond the local machine.

## Do and do not

Do use Studio to inspect tools, sandbox workspaces, memory, traces, knowledge, and pipeline runs
during development. Do configure allowed models per agent when exposing multiple providers. Do
keep the default in-memory store for disposable local sessions.

Do not expose Studio publicly without an application-level access boundary. Do not treat Studio stores as your product database.
