---
title: Sandbox tools
description: Give agents isolated command and file tools with Anvia sandbox.
section: basics
sidebar:
  group: Tools and Studio
  order: 1
---

Use `@anvia/sandbox` when an agent needs to run commands or work with files inside an isolated workspace.

## When to use this

Sandbox tools are useful for local development workflows:

- Run a build or script away from your application process.
- Read files from a temporary workspace.
- Write generated files before you inspect them.
- Limit the commands and file sizes an agent can use.

`DockerSandbox` uses Docker, so Docker must be installed and available on the machine running the agent.

## Create sandbox tools

```ts
import { AgentBuilder } from "@anvia/core";
import { createSandboxTools, DockerSandbox } from "@anvia/sandbox";

const sandbox = DockerSandbox.node({
  limits: {
    timeoutMs: 15_000,
    maxOutputBytes: 64_000,
  },
  network: false,
});

const session = await sandbox.createSession();

const sandboxTools = createSandboxTools(session, {
  include: ["exec_command", "read_file", "write_file", "list_files"],
  exec: {
    allowedCommands: ["node", "npm", "pnpm"],
    maxTimeoutMs: 15_000,
  },
  readFile: {
    maxBytes: 64_000,
  },
  writeFile: {
    maxBytes: 64_000,
  },
});

const agent = new AgentBuilder("workspace", model)
  .instructions("Use sandbox tools for workspace commands and file operations.")
  .tools(sandboxTools)
  .defaultMaxTurns(6)
  .build();
```

## What happens

`createSandboxTools` converts a sandbox session into Anvia tools:

- `exec_command`: run a command inside the sandbox.
- `read_file`: read a text file.
- `write_file`: write a text file.
- `list_files`: list files in a directory.

The tool policy controls which commands are allowed, how long commands can run, and how much file content can pass through the tools.

## Clean up

Destroy the session when your app is done with it:

```ts
await session.destroy();
```

For request-scoped sessions, use `try` and `finally` so the sandbox is cleaned up even when the run fails.

## Next

Run the agent in a local browser UI.

[Studio runtime](/docs/basics/studio-runtime)
