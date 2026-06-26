---
title: Sandbox Execution
description: The pattern for running file and command work in an isolated workspace.
section: examples
sidebar:
  group: Runtime and Integration
  order: 2
---

Sandbox execution keeps file and command tools away from the host workspace.

## Scenario

A coding agent can inspect a project, run tests, and propose patches. Commands run in a bounded sandbox session, not on the production host.

## Example

```ts
export async function createCodingRun(input: CodingRunInput) {
  const session = await input.sandbox.createSession({
    workspaceId: input.workspaceId,
    limits: {
      timeoutMs: 30_000,
      maxOutputBytes: 64_000,
    },
  });

  const agent = new AgentBuilder("coding-agent", input.model)
    .instructions("Inspect files and propose minimal changes. Do not assume commands succeeded.")
    .tools(createSandboxTools(session))
    .defaultMaxTurns(8)
    .build();

  return {
    session,
    stream: agent.prompt(input.task).stream(),
  };
}
```

Always destroy sessions after the workflow:

```ts
try {
  const run = await createCodingRun(input);
  return createEventStream(run.stream, { format: "jsonl" });
} finally {
  await input.sandbox.destroyExpiredSessions();
}
```

## Failure Modes

- Tool runs commands on the host workspace.
- Sandbox limits are missing or too broad.
- Generated files are trusted without review.
- Session cleanup is not guaranteed.

## Next Patterns

- [Coding Agent](/docs/examples/coding-agent)
- [Guarded Side Effects](/docs/examples/guarded-side-effects)
