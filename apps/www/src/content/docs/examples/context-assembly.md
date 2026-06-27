---
title: Context Assembly
description: How to decide what belongs in instructions, messages, memory, retrieval, documents, and tools.
section: examples
sidebar:
  group: Foundation Patterns
  order: 4
---

Context assembly decides how information enters a run. Use the narrowest reliable channel for each kind of information instead of stuffing everything into one prompt.

## Scenario

A customer asks, "Can I change the shipping address for A-100 like last time?" The answer needs stable support behavior, conversation history, prior preferences, policy documents, and fresh order state.

## Channels

| Channel | Put this there | Avoid |
| --- | --- | --- |
| instructions | stable behavior, safety rules, response style | request-specific user ids or live product facts |
| static context | small fixed docs needed by every run | large or frequently changing knowledge |
| messages | the current conversation | durable facts that should be normalized |
| memory/session | prior messages or durable conversation state | permission decisions or current order state |
| dynamic context | retrieved evidence from indexed knowledge | account-specific live state |
| document input | files the provider can read directly | documents that need indexing, filtering, or reuse |
| tools | live product state, permissions, writes, expensive reads | policy text that should be retrieved as evidence |

## Example

```ts
import { AgentBuilder } from "@anvia/core";
import { vectorFilter } from "@anvia/core/vector-store";

export function createCheckoutAgent(scope: CheckoutAgentScope) {
  return new AgentBuilder("checkout-support", scope.model)
    .instructions(`
Answer checkout questions for signed-in customers.
Use retrieved policy for policy answers.
Use tools for live order state and account-specific actions.
If policy evidence is missing, say what needs to be checked.
    `)
    .context(
      "Company support tone: concise, direct, and specific about next steps.",
      "support_tone",
    )
    .memory(scope.memoryStore, { savePolicy: "turn" })
    .dynamicContext(scope.policyIndex, {
      topK: 4,
      threshold: 0.72,
      filter: vectorFilter.and(
        vectorFilter.and(
          vectorFilter.eq("productArea", "checkout"),
          vectorFilter.eq("visibility", "public"),
        ),
        vectorFilter.eq("locale", scope.user.locale),
      ),
      format: (result) => ({
        id: result.id,
        text: [
          `<policy id="${result.id}" updated="${result.metadata?.updatedAt ?? "unknown"}">`,
          String(result.document),
          "</policy>",
        ].join("\n"),
      }),
    })
    .tools([
      createLookupOrderTool(scope),
      createChangeAddressTool(scope),
      createTicketTool(scope),
    ])
    .build();
}

export async function answerCheckoutQuestion(input: CheckoutQuestionInput) {
  const user = await input.auth.requireUser();
  const agent = createCheckoutAgent({ ...input, user });

  const session = agent.session(input.conversationId, {
    userId: user.id,
    metadata: { tenantId: user.tenantId },
  });

  return session.prompt(input.message).send();
}
```

Fresh order state stays behind tools because tools can enforce permissions and read current data. Support policy goes through dynamic context because it is searchable evidence. Conversation history goes through memory because it is part of the session, not a product authorization source.

## Decision Rules

| Question | Usually choose |
| --- | --- |
| Is it stable behavior? | instructions |
| Is it part of the conversation? | messages or memory |
| Is it reusable knowledge selected by relevance? | dynamic context |
| Is it a user-provided file for this run only? | document input when supported |
| Is it live product state? | tool |
| Can it change the world? | permissioned tool with validation, approval, idempotency, and audit |

## Failure Modes

- Current account state is copied into memory instead of read through tools.
- Tenant filtering is applied after retrieval instead of in the retrieval query.
- Retrieved docs are treated as permission to access account data.
- Large static context crowds out relevant messages and tool results.
- The same fact is stored in memory, retrieval, and product tables with no source of truth.

## Next Patterns

- [Agent Runtime Composition](/docs/examples/agent-runtime-composition)
- [Retrieval Agent](/docs/examples/retrieval-agent)
- [Document Grounding](/docs/examples/document-grounding)
