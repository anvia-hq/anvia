---
title: Evals, models, and MCP
description: Run eval suites, expose provider model choices, and inspect MCP-backed tools from Studio.
section: studio
sidebar:
  group: Operations
  order: 2
  label: Evals, models, and MCP
---

Studio can expose operational surfaces that do not require a chat session: eval suites, model catalogs, and MCP tool connections. These pages are useful when local validation needs more than the Playground.

## Evals

Run the eval example:

```sh
pnpm cookbook:studio:11
```

Then open:

```txt
http://localhost:4021/ui/evals
```

![Studio eval runner showing the support policy eval suite and run controls.](/assets/docs/studio/studio-evals.png)

`11-eval-runner.ts` registers a deterministic support policy suite with `exactMatch()` and `contains(...)` metrics. Studio can run the suite from the browser and the raw API is available at:

```txt
http://localhost:4021/evals/studio-support-policy/runs
```

Use this for local checks where the target is deterministic enough to evaluate without provider calls.

## Model Selection

Run the multi-provider example:

```sh
pnpm cookbook:studio:13
```

It registers OpenAI and Anthropic providers, declares model metadata, and limits the `studio-model-router` agent to explicit allowed model refs.

Use this when you need to compare provider behavior or route multimodal work while keeping model choices visible and policy-bound.

## MCP Tools

Run the MCP example:

```sh
pnpm cookbook:studio:14
```

It connects a local stdio MCP server, registers the MCP-backed agent, and exposes MCP tools in both the Playground and MCP inspector pages:

```txt
http://localhost:4021/ui/mcps
http://localhost:4021/ui/tools
```

Use the MCP page to inspect connected servers and available tools before debugging agent behavior.

## Related Cookbook Files

- `examples/cookbook/09_studio/11-eval-runner.ts`
- `examples/cookbook/09_studio/13-multi-provider-models.ts`
- `examples/cookbook/09_studio/14-mcp-tools.ts`
