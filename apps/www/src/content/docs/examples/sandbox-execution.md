---
title: Sandbox Execution
description: A pattern for running file and command tools in an isolated workspace.
section: examples
sidebar:
  group: Runtime and Integration
  order: 2
---

Sandbox execution keeps file and command tools away from the host workspace. The sandbox owns process execution and file access; the agent only receives narrow tools with explicit policy.

## Scenario

A coding agent can inspect a project, run focused checks, and propose patches. Commands run in a bounded sandbox session. Generated changes are returned for review instead of being trusted automatically.

## Flow

| Step | Boundary |
| --- | --- |
| create session | sandbox service |
| choose tool policy | app runtime |
| stream coding run | agent |
| collect patch/review output | app review queue |
| destroy session | app cleanup |

## Example

```ts
import { AgentBuilder } from "@anvia/core";
import { createSandboxTools } from "@anvia/sandbox";

export async function createCodingRun(input: CodingRunInput) {
  const session = await input.sandbox.createSession({
    workspace: { mode: "persistent", id: input.workspaceId },
    metadata: { userId: input.user.id, workspaceId: input.workspaceId },
  });

  const tools = createSandboxTools(session, {
    allow: ["list_files", "read_file", "write_file", "exec_command"],
    readFile: { maxBytes: 120_000 },
    writeFile: { maxBytes: 120_000 },
    exec: {
      allowedCommands: ["pnpm", "npm", "node", "git"],
      blockedCommands: ["rm", "curl", "ssh"],
      defaultTimeoutMs: 30_000,
      maxTimeoutMs: 120_000,
    },
  });

  const agent = new AgentBuilder("coding-agent", input.model)
    .instructions(`
Inspect files before editing.
Prefer focused commands over broad test suites.
Summarize changed files and verification.
Never claim a command passed unless the tool result says it did.
    `)
    .tools(tools)
    .defaultMaxTurns(10)
    .build();

  return {
    session,
    stream: agent
      .prompt(input.task)
      .withTrace({
        name: "coding-task",
        userId: input.user.id,
        metadata: { workspaceId: input.workspaceId },
      })
      .stream(),
  };
}
```

Cleanup and review:

```ts
export async function runCodingTask(input: CodingRunInput) {
  const run = await createCodingRun(input);

  try {
    let finalOutput = "";
    for await (const event of run.stream) {
      await input.events.append({ workspaceId: input.workspaceId, event });
      if (event.type === "final") {
        finalOutput = event.output;
      }
    }

    const patch = await run.session.readTextFile(".anvia/patch.diff");
    await input.reviewQueue.create({
      workspaceId: input.workspaceId,
      summary: finalOutput,
      patch,
      sessionId: run.session.id,
    });

    return { output: finalOutput };
  } finally {
    await run.session.destroy();
  }
}
```

## Failure Modes

- Tool runs commands on the host workspace.
- Sandbox limits are missing or too broad.
- Generated files are trusted without review.
- Session cleanup is not guaranteed.
- Large command output or file content is returned unbounded.

## Next Patterns

- [Coding Agent](/docs/examples/coding-agent)
- [Streaming Events](/docs/examples/streaming-events)
- [Guarded Side Effects](/docs/examples/guarded-side-effects)
