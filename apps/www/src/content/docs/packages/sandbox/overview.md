---
title: "@anvia/sandbox: Overview"
description: "Docker-backed sandbox tools for running commands and file operations in controlled Anvia agent workspaces."
section: packages
sidebar:
  group: "@anvia/sandbox"
  order: 1
  label: "Overview"
---
## What it is

Docker-backed sandbox tools for running commands and file operations in controlled Anvia agent workspaces.

Use @anvia/sandbox when the application needs agents to run commands or inspect files inside an isolated Docker workspace. It is one of the developer workflow packages for tools, local runtime inspection, and controlled execution.

## Where it fits

`@anvia/sandbox` provides model-facing tools backed by Docker workspaces. Use it beside `@anvia/core` tools and approval policies when agents need controlled command or file access.

The package owns sandbox lifecycle, command execution helpers, file limits, and model-facing tool definitions. Keep workspace policy, Docker availability, secret handling, network policy, and approval decisions in application code.

## Public surface

The main documented exports are `DockerSandbox`, `Sandbox Interfaces`, `Session Options`, `Docker Options`, `Execution`, `Files`. The reference page lists the package entrypoint and public symbols that are checked by the docs reference coverage script.

## Next pages

- [Getting Started](/docs/packages/sandbox/getting-started)
- [Usage Patterns](/docs/packages/sandbox/usage-patterns)
- [Examples](/docs/packages/sandbox/examples)
- [Changelog](/docs/packages/sandbox/changelog)
- [Reference](/docs/packages/sandbox/reference)
