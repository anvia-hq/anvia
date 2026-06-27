---
title: Coding Agent
description: A real-case codebase workflow with sandboxed files, commands, patch review, and verification.
section: examples
sidebar:
  group: Real Cases
  order: 4
---

A coding agent needs a workspace boundary. File reads, commands, patches, and git operations should be scoped, logged, and reviewable. The agent can propose changes; the application decides how they are reviewed and applied.

## Scenario

A developer asks the agent to fix a failing test. The agent can inspect files and run commands in a sandbox, write a patch, and create a review item with verification output.

## Flow

| Step | Pattern |
| --- | --- |
| create sandbox | Sandbox Execution |
| expose file/command tools | Permissioned Tools |
| stream progress | Streaming Events |
| collect patch | Runtime State and Persistence |
| create review | Guarded Side Effects |

## Example

```ts
import { AgentBuilder } from "@anvia/core";
import { createSandboxTools } from "@anvia/sandbox";

export async function runCodingTask(input: CodingTaskInput) {
  const session = await input.sandbox.createSession({
    workspace: { mode: "persistent", id: input.workspaceId },
    metadata: { userId: input.user.id },
  });

  const agent = new AgentBuilder("coding-agent", input.model)
    .instructions(`
Inspect before editing.
Run focused checks when possible.
Write proposed changes to .anvia/patch.diff.
Summarize changed files and verification.
Never claim a command passed unless the tool result says it did.
    `)
    .tools(createSandboxTools(session, {
      allow: ["list_files", "read_file", "write_file", "exec_command"],
      readFile: { maxBytes: 160_000 },
      writeFile: { maxBytes: 160_000 },
      exec: {
        allowedCommands: ["pnpm", "npm", "node", "git"],
        defaultTimeoutMs: 30_000,
        maxTimeoutMs: 120_000,
      },
    }))
    .defaultMaxTurns(10)
    .build();

  try {
    let finalOutput = "";
    for await (const event of agent
      .prompt(input.task)
      .withTrace({
        name: "coding-task",
        userId: input.user.id,
        metadata: { workspaceId: input.workspaceId },
      })
      .stream()) {
      await input.events.append({ workspaceId: input.workspaceId, event });
      if (event.type === "final") {
        finalOutput = event.output;
      }
    }

    const patch = await session.readTextFile(".anvia/patch.diff");

    await input.reviewQueue.create({
      workspaceId: input.workspaceId,
      requestedBy: input.user.id,
      summary: finalOutput,
      patch,
      sandboxSessionId: session.id,
    });

    return { output: finalOutput };
  } finally {
    await session.destroy();
  }
}
```

## Review Boundary

The review queue should store:

| Field | Why |
| --- | --- |
| patch | human-visible proposed changes |
| final summary | model explanation |
| command events | verification record |
| sandbox session id | reproducibility |
| requester id | permission and audit |

## Failure Modes

- Commands run on the host instead of the sandbox.
- Generated patches are applied without review.
- The agent edits before inspecting the repo.
- Verification output is not stored with the review.
- Sandbox sessions are not destroyed or expired.

## Next Patterns

- [Sandbox Execution](/docs/examples/sandbox-execution)
- [Streaming Events](/docs/examples/streaming-events)
- [Testing Harness](/docs/examples/testing-harness)
