---
title: "@anvia/sandbox: Examples"
description: "Small examples that show @anvia/sandbox at the package boundary."
section: packages
sidebar:
  group: "@anvia/sandbox"
  order: 4
  label: "Examples"
---
## Minimal sandbox tools

```ts
import { AgentBuilder } from "@anvia/core";
import { DockerSandbox, createSandboxTools } from "@anvia/sandbox";

const sandbox = DockerSandbox.node({ network: false });
const session = await sandbox.createSession({ id: "demo" });
const tools = createSandboxTools(session);

const agent = new AgentBuilder("workspace-agent", model).tools(tools).build();
```
## Product-shaped approval boundary

```ts
const sandbox = DockerSandbox.node({
  network: false,
  limits: { timeoutMs: 30_000, maxOutputBytes: 64_000 },
});
const session = await sandbox.createSession({
  id: request.id,
  workspace: { mode: "persistent", id: request.id },
});

const agent = new AgentBuilder("debugger", model)
  .instructions("Inspect the sandbox and propose changes before writing files.")
  .tools(
    createSandboxTools(session, {
      include: ["exec_command", "read_file", "list_files"],
      exec: { allowedCommands: ["node", "pnpm", "ls", "cat"] },
      readFile: { maxBytes: 64_000 },
    }),
  )
  .approvals({
    handler: async (approval) => {
      return {
        approved: await reviewSandboxAction(approval),
        reason: "Reviewed before sandbox execution.",
      };
    },
  })
  .build();
```
## Harness shape

```ts
import { describe, expect, it } from "vitest";

describe("@anvia/sandbox integration", () => {
  it("keeps the package boundary injectable", () => {
    expect(true).toBe(true);
  });
});
```
Replace the assertion with a focused check around the package boundary: stream format for server/react, observer registration for logging/tracing, or runtime target registration for Studio.
