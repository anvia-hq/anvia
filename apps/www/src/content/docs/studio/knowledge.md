---
title: Knowledge inspector
description: Inspect static context, dynamic context, dynamic tools, and retrieval evidence for Studio-registered agents.
section: studio
sidebar:
  group: Inspection
  order: 2
  label: Knowledge
---

The Knowledge page explains what context and retrieval surfaces an agent can use. It is an inspector, not a document editor: your application owns ingestion, vector stores, source documents, and tool catalogs.

Run the knowledge example:

```sh
pnpm cookbook:studio:05
```

Then open:

```txt
http://localhost:4021/ui/knowledge
```

![Studio knowledge inspector showing dynamic context chunks and metadata.](/assets/docs/studio/studio-knowledge.png)

## Static Context

`05-knowledge-inspector.ts` attaches static context with `.context(...)`. Studio displays that source so you can verify the always-on instructions and facts that every run receives.

Static context should be safe for every run of the agent. Do not put request-specific identity, permissions, or private customer state in static context.

## Dynamic Context

The example builds an in-memory vector index from operational notes, then registers it with `.dynamicContext(...)`. Studio can show the configured source and the evidence returned during runs.

Use this page to confirm that retrieval is wired to the right index, result shape, metadata, threshold, and `topK` before investigating answer quality.

## Dynamic Tools

The same example builds a tool index with `createToolIndex(...)` and registers it through `.dynamicTools(...)`. Studio shows these dynamic tool sources separately from static tools.

Dynamic tools are useful when an agent should discover a subset of available tools from the current request instead of receiving every possible tool up front.

## Related Cookbook File

- `examples/cookbook/09_studio/05-knowledge-inspector.ts`
