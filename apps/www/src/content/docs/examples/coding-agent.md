---
title: Coding Agent
description: A real-case pattern for codebase workflows with file, command, patch, and review boundaries.
section: examples
sidebar:
  group: Real Cases
  order: 4
---

A coding agent needs a workspace boundary. File reads, commands, patches, and git operations should be scoped, logged, and reviewable.

## Scenario

A developer asks the agent to fix a failing test. The agent can inspect files and run commands in a sandbox, then produce a patch for review.

## Example

```ts
export async function runCodingTask(input: CodingTaskInput) {
  const session = await input.sandbox.createSession({
    workspaceId: input.workspaceId,
    limits: { timeoutMs: 30_000, maxOutputBytes: 80_000 },
  });

  const agent = new AgentBuilder("coding-agent", input.model)
    .instructions(`
Inspect before editing.
Run focused checks when possible.
Summarize changed files and verification.
Never claim a command passed unless the tool result says it did.
    `)
    .tools(createSandboxTools(session))
    .defaultMaxTurns(10)
    .build();

  try {
    const response = await agent
      .prompt(input.task)
      .withTrace({
        name: "coding-task",
        userId: input.user.id,
        metadata: { workspaceId: input.workspaceId },
      })
      .send();

    await input.reviewQueue.create({
      workspaceId: input.workspaceId,
      summary: response.output,
      sessionId: session.id,
    });

    return { output: response.output };
  } finally {
    await session.destroy();
  }
}
```

## Failure Modes

- Commands run on the host instead of the sandbox.
- Generated patches are applied without review.
- The agent edits before inspecting the repo.
- Verification output is not stored with the review.

## Next Patterns

- [Sandbox Execution](/docs/examples/sandbox-execution)
- [Streaming Events](/docs/examples/streaming-events)
- [Testing Harness](/docs/examples/testing-harness)
