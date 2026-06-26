---
title: Schemas and structured output
description: Validate model, agent, tool, and extractor data with schemas.
section: advanced
sidebar:
  group: Structured workflows
  order: 40
  label: Schemas
---

Structured output is how model text becomes application data. Treat the schema as the contract your product code will trust after validation, not as decoration in the prompt.

Core uses Zod schemas across the structured workflow surface:

- agent final output with `.outputSchema(...)`
- direct parsed completions with `createParsedCompletion(...)`
- extractor results through `ExtractorBuilder`
- pipeline input schemas

The provider may use the schema to guide generation, but your application should still validate when text crosses into product data.

## Define The Contract

```ts
import { z } from "zod";

const ticketClassificationSchema = z.object({
  category: z.enum(["billing", "technical", "account"]),
  priority: z.enum(["low", "normal", "high"]),
  summary: z.string().min(1),
  needsHumanReview: z.boolean(),
});
```

Prefer narrow schemas. Enums, booleans, numbers, and required strings are easier to evaluate and test than loose nested objects.

Use field descriptions when the name alone is ambiguous:

```ts
const escalationSchema = z.object({
  reason: z.string().describe("Short reason the ticket should be escalated."),
  severity: z.enum(["normal", "urgent"]),
});
```

Descriptions are converted into provider JSON schema metadata.

## Agent Final Output

Use `.outputSchema(...)` when the agent's final answer should be schema-shaped:

```ts
import { AgentBuilder } from "@anvia/core";
import { z } from "zod";

const classificationSchema = z.object({
  category: z.enum(["billing", "technical", "account"]),
  confidence: z.number(),
  customerMessage: z.string(),
});

const agent = new AgentBuilder("ticket-classifier", model)
  .instructions("Classify the ticket and return only the requested object.")
  .outputSchema(classificationSchema)
  .build();

const request = agent.prompt("I cannot update my payment method.");
const response = await request.send();

const data = classificationSchema.parse(JSON.parse(response.output));
```

The schema is sent on the model request. Local parsing still belongs near the boundary where text becomes trusted data.

Use this pattern when the agent may need tools or runtime context before producing a final structured answer.

## Direct Completion Output

Use `createParsedCompletion(...)` when you need one direct model call that returns validated data:

```ts
import { createParsedCompletion } from "@anvia/core";
import { z } from "zod";

const summarySchema = z.object({
  title: z.string(),
  bullets: z.array(z.string()).min(2).max(4),
});

const summary = await createParsedCompletion(model, {
  schema: summarySchema,
  instructions: "Return only the requested summary object.",
  input: "Summarize why tool calling is useful.",
});

console.log(summary.data.title);
```

`createParsedCompletion(...)` sends the schema as the output schema, reads the model response text as JSON, and parses it with Zod before returning `data`.

Use this for a single model call. Use an agent when the workflow needs tools, memory, dynamic context, hooks, observers, approvals, or run control.

## Parsed Completion Versus Extractor

`createParsedCompletion(...)` and `ExtractorBuilder` both return schema-validated data, but they use different model patterns.

Use `createParsedCompletion(...)` when the model should answer directly with a JSON-shaped final response:

- classification from one prompt
- summarization into an object
- small transformations where the whole answer is the schema
- one-off calls that do not need extractor retries or a submit-tool interaction

Use `ExtractorBuilder` when the job is extraction from supplied content:

- parse fields from invoices, tickets, resumes, transcripts, or notes
- force the model to call a generated `submit` tool
- retry when the model does not submit data or submits invalid fields
- keep extraction usage and extraction messages for audit or evals

The practical rule: parsed completion is a direct structured answer; extractor is a schema-first extraction workflow. If the input is a document-like blob and the output is records or fields from that blob, reach for an extractor. If the prompt itself asks the model to produce one structured answer, use `createParsedCompletion(...)`.

## Extractors

Use an extractor when the job is to convert existing text into data:

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

Extractors validate the submitted data before returning it and can retry when the model omits the submit call or returns invalid fields.

## Pipeline Input Schemas

Pipelines use a Zod schema at construction:

```ts
import { PipelineBuilder } from "@anvia/core/pipeline";
import { z } from "zod";

const SupportInput = z.object({
  customer: z.string(),
  message: z.string().min(1),
  priorityHint: z.enum(["low", "normal", "high"]).default("normal"),
});

const pipeline = new PipelineBuilder(SupportInput)
  .step((input) => ({
    ...input,
    message: input.message.trim(),
  }))
  .build();
```

Invalid input throws before any stage runs, so pipeline steps can assume they receive parsed data.

## Failure Policy

Decide failure behavior by workflow:

- agent output: parse once at the runner boundary, then retry or map a product error
- direct completion: parse at the call site and treat parse failure as provider or prompt failure
- extractor: configure `.retries(...)` for missing or invalid submit data
- tool output: let schema validation fail before bad data reaches the model
- pipeline input: reject before work starts

Do not let unparsed model output flow into product writes, billing, permissions, or customer-visible status changes.
