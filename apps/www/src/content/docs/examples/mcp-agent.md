---
title: MCP Agent
description: A pattern for combining reviewed MCP tools with app-owned tools.
section: examples
sidebar:
  group: Runtime and Integration
  order: 1
---

MCP tools should be inspected, filtered, and wrapped before they join product tools. Treat an MCP server as an external capability source, not as permission to expose every remote action to the model.

## Scenario

A coding assistant can use read-only MCP documentation tools plus app-owned workspace tools. File writes and commands must stay in the app sandbox, not in the MCP docs server.

## Flow

| Step | Owner |
| --- | --- |
| connect to MCP server | app runtime |
| list and inspect tools | MCP adapter |
| filter allowed tools | app policy |
| combine with app tools | agent factory |
| enforce writes/commands | app sandbox tools |

## Example

```ts
import { AgentBuilder, type AnyTool } from "@anvia/core";
import { connectMcp, mcp } from "@anvia/core/mcp";
import { createSandboxTools } from "@anvia/sandbox";

export async function createCodingAssistant(input: CodingAssistantInput) {
  const docsServer = await connectMcp(
    mcp.http({
      name: "internal-docs",
      url: input.docsMcpUrl,
    }),
  );

  const docsTools = await filterMcpTools(docsServer.tools, new Set(["search_docs", "read_doc"]));

  const workspaceTools = createSandboxTools(input.sandboxSession, {
    allow: ["read_file", "write_file", "list_files", "exec_command"],
    readFile: { maxBytes: 120_000 },
    writeFile: { maxBytes: 120_000 },
    exec: {
      allowedCommands: ["pnpm", "npm", "node", "git"],
      blockedCommands: ["rm", "curl"],
      defaultTimeoutMs: 30_000,
      maxTimeoutMs: 120_000,
    },
  });

  return new AgentBuilder("coding-assistant", input.model)
    .instructions(`
Use docs MCP tools only for reference.
Use sandbox tools for workspace files and commands.
Do not claim a command passed unless the tool result says it passed.
    `)
    .tools([...docsTools, ...workspaceTools])
    .defaultMaxTurns(8)
    .build();
}

async function filterMcpTools(tools: AnyTool[], allowedNames: Set<string>) {
  const reviewed = [];

  for (const tool of tools) {
    const definition = await tool.definition("");
    if (allowedNames.has(definition.name)) {
      reviewed.push(tool);
    }
  }

  return reviewed;
}
```

## Review Checklist

| Check | Why |
| --- | --- |
| allow-list tool names | avoids exposing unexpected remote actions |
| inspect descriptions and schemas | catches broad or confusing tools |
| keep app writes in app tools | preserves app permission and audit paths |
| handle connection failure | lets the agent degrade instead of crashing all routes |
| avoid name collisions | keeps model tool calls unambiguous |

## Failure Modes

- Every server tool is exposed without review.
- MCP tools bypass app permission checks.
- Tool names collide with app tools.
- Reconnection failure disables the whole agent instead of degrading capability.
- Remote tools return large or sensitive payloads without app-side filtering.

## Next Patterns

- [Permissioned Tools](/docs/examples/permissioned-tools)
- [Sandbox Execution](/docs/examples/sandbox-execution)
- [Dynamic Tool Catalogs](/docs/examples/dynamic-tool-catalogs)
