---
title: "@anvia/sandbox: Getting Started"
description: "Install @anvia/sandbox and wire it into an Anvia project."
section: packages
sidebar:
  group: "@anvia/sandbox"
  order: 2
  label: "Getting Started"
---
## Install

```sh
pnpm add @anvia/sandbox @anvia/core
```

## Minimum setup

```ts
import { AgentBuilder } from "@anvia/core";
import { DockerSandbox, createSandboxTools } from "@anvia/sandbox";

const sandbox = DockerSandbox.node({
  network: false,
});
const session = await sandbox.createSession({
  id: "support-debug",
});

const sandboxTools = createSandboxTools(session, {
  exec: {
    maxTimeoutMs: 30_000,
  },
});

const agent = new AgentBuilder("debugger", model)
  .instructions("Inspect files only inside the sandbox workspace.")
  .tools(sandboxTools)
  .defaultMaxTurns(8)
  .build();
```
## Next step

Continue with [Usage Patterns](/docs/packages/sandbox/usage-patterns).
