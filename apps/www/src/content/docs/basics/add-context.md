---
title: Add context
description: Attach static context before moving into retrieval workflows.
section: basics
sidebar:
  group: Capabilities
  order: 4
---

Static context sends the same documents with every request to an agent.

## When to use this

Use static context for small, stable facts:

- Product policy.
- Internal glossary.
- Launch checklist.
- Support escalation notes.

Do not use static context for large or frequently changing knowledge bases. Use retrieval later for that.

## Add context

```ts
import { AgentBuilder } from "@anvia/core";

const agent = new AgentBuilder("support", model)
  .instructions("Answer from the supplied context when it is relevant.")
  .context(
    [
      "DeltaKit Launch Policy",
      "Every production launch must have one launch captain.",
      "The launch captain owns rollback, customer notice, and go/no-go decisions.",
      "For checkout launches, the default launch captain is Mira.",
    ].join("\n"),
    "launch_policy",
  )
  .build();

const response = await agent
  .prompt("Who owns the checkout launch checklist?")
  .send();

console.log(response.output);
```

## What happens

Context documents are sent with the model request. They are available to the model without requiring a tool call.

Static context is the simplest grounding mechanism. Retrieval adds a search step before the model call and belongs outside the first Basics path.

## Next

Expose runtime streams from a server route.

[Server streams](/docs/basics/server-streams)
