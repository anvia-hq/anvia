---
title: MCP Agent
description: The pattern for combining app tools with MCP server tools.
section: examples
sidebar:
  group: Runtime and Integration
  order: 1
---

MCP tools should be inspected, filtered, and wrapped before they join product tools.

## Scenario

A coding assistant can use app-owned project tools plus read-only MCP documentation tools. File writes must stay in the app's sandbox tools.

## Example

```ts
const docsServer = await mcp.connect("internal-docs");

const safeMcpTools = docsServer.tools.filter((tool) =>
  ["search_docs", "read_doc"].includes(tool.definition().name),
);

const agent = new AgentBuilder("coding-assistant", model)
  .instructions("Use docs tools for reference. Use app tools for workspace changes.")
  .tools([
    ...safeMcpTools,
    ...createWorkspaceTools({
      workspaceId: input.workspaceId,
      sandbox: input.sandbox,
    }),
  ])
  .defaultMaxTurns(6)
  .build();
```

## Failure Modes

- Every server tool is exposed without review.
- MCP tools bypass app permission checks.
- Tool names collide with app tools.
- Reconnection failure disables the whole agent instead of degrading capability.

## Next Patterns

- [Tool Boundaries](/docs/examples/tool-boundaries)
- [Sandbox Execution](/docs/examples/sandbox-execution)
