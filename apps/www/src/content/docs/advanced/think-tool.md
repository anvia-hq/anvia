---
title: Think tool
description: Add deliberate reasoning checkpoints to agent tool use.
section: advanced
sidebar:
  group: Tools and action safety
  order: 25
---

The think tool gives an agent a harmless place to record an intermediate thought during a complex run. It does not retrieve information, store memory, call external services, or change product state.

Use it when an agent benefits from a deliberate checkpoint before choosing another tool or final answer.

## Add The Think Tool

```ts
import { AgentBuilder, createThinkTool } from "@anvia/core";

const agent = new AgentBuilder("incident-review", model)
  .instructions(
    [
      "Investigate incidents carefully.",
      "Use think before taking a high-impact action.",
      "Do not expose private tool results in the final answer.",
    ].join("\n"),
  )
  .tool(createThinkTool())
  .tools(incidentTools)
  .build();
```

The default tool name is `think`. You can rename it when the agent already has a tool with that name:

```ts
const scratchpadTool = createThinkTool({
  name: "scratchpad",
  description: "Record a short internal checkpoint before continuing.",
});
```

## What It Does

`createThinkTool(...)` creates a normal tool with:

- input schema `{ thought: string }`
- output schema `string`
- handler that returns the thought text

Because it is a normal tool, think calls appear in runtime events, tool results, memory messages, observers, and event stores according to the same runtime rules as other tools.

## When It Helps

Think is useful for:

- multi-step investigations
- deciding which tool to call next
- checking whether enough evidence exists for a final answer
- making the agent pause before sensitive tools
- internal Studio or operations debugging

It is not a replacement for retrieval, memory, approvals, or deterministic policy code.

## Pair With Instructions

The model will only use the think tool when it sees a reason. Make the expected behavior explicit:

```ts
const agent = new AgentBuilder("support", model)
  .instructions(
    "Use think when a request requires comparing tool results or planning multiple steps.",
  )
  .tool(createThinkTool())
  .build();
```

Avoid telling the model to use think on every turn. That adds latency and noise without improving simple requests.

## Privacy And Persistence

Think output is part of the tool transcript. If memory is enabled, it may be persisted like other tool messages. If streaming or event storage is enabled, it may appear in runtime events.

Do not use think for secrets, credentials, hidden policy, or private chain-of-thought that should never be stored. Use it for concise operational checkpoints.

## Checklist

Before adding think, check:

- the workflow is complex enough to need a checkpoint
- the instruction says when to use it
- persisted think output is acceptable for your memory policy
- user-facing streams filter tool events when needed
- deterministic policy still lives in tools, hooks, or runner code
