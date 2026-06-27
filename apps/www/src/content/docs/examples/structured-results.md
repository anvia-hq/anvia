---
title: Structured Results
description: Patterns for returning typed data from direct completions, agents, extractors, and pipelines.
section: examples
sidebar:
  group: Foundation Patterns
  order: 5
---

Structured results turn model output into application data. Pick the pattern based on the workflow, not just on the schema shape.

## Scenario

A support system needs three typed outputs: classify an incoming ticket, let an agent return a final action summary, and extract invoice fields from uploaded text. Each uses a schema, but the runtime shape is different.

## Choose The Shape

| Need | Pattern |
| --- | --- |
| One direct model call returns data | `createParsedCompletion(...)` |
| A tool-using agent ends with a typed final result | agent `.outputSchema(...)` |
| Existing text must be converted into records | `ExtractorBuilder` |
| Multi-step work needs typed input and stages | pipeline input schemas |

## Direct Parsed Completion

```ts
import { createParsedCompletion } from "@anvia/core";
import { z } from "zod";

const ticketSchema = z.object({
  category: z.enum(["billing", "technical", "account"]),
  priority: z.enum(["low", "normal", "high"]),
  summary: z.string(),
});

const ticket = await createParsedCompletion(model, {
  schema: ticketSchema,
  instructions: "Classify this support message.",
  input: "I cannot update my card.",
});

await tickets.route(ticket.data);
```

Use this when one prompt should produce one validated object and the model does not need tools, memory, or runtime context.

## Agent Final Output

```ts
import { AgentBuilder } from "@anvia/core";
import { z } from "zod";

const supportResultSchema = z.object({
  answer: z.string(),
  actionsTaken: z.array(z.string()),
  needsHuman: z.boolean(),
});

const agent = new AgentBuilder("support", model)
  .instructions("Use tools when account state is needed. Return the final result object.")
  .tools(createSupportTools(scope))
  .outputSchema(supportResultSchema)
  .build();

const response = await agent.prompt(input.message).send();
const result = supportResultSchema.parse(JSON.parse(response.output));
```

Use this when the final response should be typed after the agent has used tools, context, memory, observers, or approvals. Check the selected provider path supports output schemas before relying on this pattern.

## Extractor

```ts
import { ExtractorBuilder } from "@anvia/core/extractor";
import { z } from "zod";

const invoiceSchema = z.object({
  invoiceNumber: z.string(),
  amountDue: z.number(),
  dueDate: z.string().nullable(),
});

const extractor = new ExtractorBuilder(model, invoiceSchema)
  .instructions("Extract invoice fields from the supplied text.")
  .retries(1)
  .build();

const invoice = await extractor.extract(invoiceText);
```

Use extractors when the job is to pull structured fields from provided content. Extractors use a required submit tool and can retry when the model fails to submit valid data.

## Production Checks

- The schema is narrow enough to evaluate and test.
- Application code parses or validates before trusting model text.
- Provider capability support is checked for final output schemas.
- Expected validation failures become product errors or retries.
- Extracted data is audited with the source document id or run id.

## Next Patterns

- [Agent Runtime Composition](/docs/examples/agent-runtime-composition)
- [RAG Ingestion](/docs/examples/rag-ingestion)
- [Testing Harness](/docs/examples/testing-harness)
