---
title: Instructions and context
description: Shape agent behavior with instructions and request context.
section: advanced
sidebar:
  group: Agent runtime
  order: 12
  label: Instructions
---

Instructions define durable behavior. Context gives the model facts to use for a run. Keep those separate so production behavior is easier to test, review, and change.

Use instructions for how the agent should behave. Use context for what the agent should know.

## Stable Instructions

Put stable operating rules on the agent:

```ts
const agent = new AgentBuilder("support", model)
  .instructions(
    [
      "Answer from verified support information.",
      "Use tools before making account-specific claims.",
      "Escalate billing, legal, or security uncertainty.",
      "Do not expose private tool output directly to the user.",
    ].join("\n"),
  )
  .build();
```

Instructions should describe durable policy, role, tone, and workflow rules. They should not carry the current user's permissions, tenant id, database ids, or request-specific facts.

## Multiple Instruction Calls

Calling `.instructions(...)` more than once appends another instruction block. It does not replace the previous block.

```ts
const agent = new AgentBuilder("support", model)
  .instructions("Answer from verified support information.")
  .instructions("Use tools before making account-specific claims.")
  .instructions("Escalate billing, legal, or security uncertainty.")
  .build();
```

At build time, core joins the blocks with a blank line between them. The model receives one combined instruction string:

```txt
Answer from verified support information.

Use tools before making account-specific claims.

Escalate billing, legal, or security uncertainty.
```

This is useful when different modules contribute stable behavior. For example, a base factory can add product rules, a feature factory can add workflow rules, and `.skills(...)` can add skill instructions. Core places normal instruction blocks first and skill instruction blocks after them.

```ts
const agent = new AgentBuilder("research", model)
  .instructions(baseAgentRules)
  .instructions(researchWorkflowRules)
  .skills(researchSkills)
  .build();
```

Keep the order intentional. Later instruction blocks do not erase earlier ones, but contradictory instructions still make the final prompt harder for the model to follow. If a request needs different behavior, create a different agent or factory rather than trying to override stable instructions with another appended block.

## Static Context

Use `.context(text, id)` for small documents that are safe and useful for every run of the agent:

```ts
const agent = new AgentBuilder("release-notes", model)
  .instructions("Answer questions about the current release.")
  .context(currentReleaseNotes, "release-notes")
  .context(supportPolicySummary, "support-policy")
  .build();
```

Static context is sent alongside completion requests. Keep it short and stable. If the content is large, tenant-specific, permissioned, or frequently changing, use retrieval or a tool instead.

## Dynamic Context

Use dynamic context when relevant documents should be selected from an index for each turn:

```ts
import { vectorFilter } from "@anvia/core/vector-store";

const agent = new AgentBuilder("docs-support", model)
  .instructions("Use retrieved documentation before answering.")
  .dynamicContext(docsIndex, {
    topK: 5,
    threshold: 0.72,
    filter: vectorFilter.eq("product", "platform"),
  })
  .build();
```

During a run, core extracts text from the current prompt, searches the registered index, formats matching results as documents, and sends those documents into the model request for that turn.

Use filters for product, tenant, language, access tier, or document type. Do not depend on prompt instructions to prevent unauthorized retrieval results; enforce access in the index, filter, or retrieval adapter.

## Request Context

Request-specific data belongs in the runner, session options, trace metadata, tools, or middleware:

```ts
const response = await agent
  .session(conversationId, {
    userId: user.id,
    metadata: { tenantId: user.tenantId },
  })
  .prompt(input.message)
  .withTrace({
    name: "support-chat",
    userId: user.id,
    metadata: { tenantId: user.tenantId, conversationId },
  })
  .send();
```

Session metadata helps your memory store route and audit the conversation. Trace metadata helps observers correlate runtime behavior with application logs. Tool factories should receive user and tenant state when a tool needs to enforce product permissions.

## Prompt Input

The prompt should contain the user's current request. Avoid packing hidden application state into a long user message. If the state affects permissions or side effects, pass it through services and tools. If the state affects observability, pass it through trace metadata. If the state affects conversation history, pass it through memory and sessions.

For conversations, use `agent.session(id).prompt(message)`. Do not rebuild transcript arrays at the prompt call site.

## Instructions Versus Tools

Instructions can tell the model to use a tool. They cannot guarantee product safety.

For example, an instruction can say "only refund eligible orders", but the refund tool must still validate the order, user, tenant, amount, and approval state before performing the refund. Treat the tool as the enforcement point.

## Review Checklist

Before shipping an instruction or context change, check:

- Does this instruction apply to every run of the agent?
- Is any user, tenant, or permission data hidden in prompt text?
- Would this static context be safe for every user who can run the agent?
- Should large or changing context be moved to retrieval?
- Does every side-effect tool enforce its own permissions?
- Can a test assert the behavior without real provider credentials or production data?

If the answer is unclear, move the product decision out of instructions and into runner code, retrieval filters, tools, or middleware.
