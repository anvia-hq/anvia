---
title: Extractors
description: Extract structured records from unstructured content.
section: advanced
sidebar:
  group: Structured workflows
  order: 41
---

Extractors convert text into validated data. Internally, core builds a small agent with a required `submit` tool generated from your schema. The model must call that tool, and core parses the submitted arguments with Zod before returning data.

Use extractors for invoices, tickets, resumes, policies, meeting notes, support messages, research notes, and other unstructured content that your app needs as typed records.

## Build An Extractor

```ts
import { ExtractorBuilder } from "@anvia/core/extractor";
import { z } from "zod";

const ticketSchema = z.object({
  customer: z.string(),
  issue: z.string(),
  priority: z.enum(["low", "normal", "high"]),
  needsHumanReview: z.boolean(),
});

const ticketExtractor = new ExtractorBuilder(model, ticketSchema)
  .instructions("Extract a support ticket from the provided note.")
  .retries(1)
  .build();
```

The extractor adds default instructions and a `submit` tool. Extra `.instructions(...)` should clarify domain rules, not repeat the schema.

## Extract Data

```ts
const ticket = await ticketExtractor.extract(
  "Acme Co. reports checkout outage and missed orders after payment retries failed.",
);

console.log(ticket.priority);
```

`extract(...)` returns schema-validated data. If the model does not call `submit`, or the submitted arguments fail validation, the extractor retries according to `.retries(...)` and then throws `ExtractionError`.

## Keep Usage When Needed

Use `extractWithUsage(...)` when the runner needs usage or the messages produced by the extraction call:

```ts
const extraction = await ticketExtractor.extractWithUsage(noteText);

await auditLog.write({
  kind: "ticket_extraction",
  usage: extraction.usage,
  extractedPriority: extraction.data.priority,
});
```

Do not use returned messages as your normal chat history pattern. Durable conversation history belongs in memory and sessions. Extractor messages are useful for audit, debugging, or evaluation of the extraction call itself.

## Add Static Context

Use `.context(...)` for small facts that should always apply:

```ts
const priorityExtractor = new ExtractorBuilder(model, ticketSchema)
  .context("If the note says checkout is unavailable, use high priority.", "priority-rules")
  .instructions("Prefer explicit evidence from the note.")
  .retries(1)
  .build();
```

For large or tenant-specific knowledge, retrieve and format the relevant facts before calling the extractor, or put extraction inside a pipeline that prepares the text first.

## Configure Model Options

Extractor builder options are passed to the internal agent request:

```ts
const extractor = new ExtractorBuilder(model, ticketSchema)
  .temperature(0)
  .maxTokens(500)
  .additionalParams({ seed: 1 })
  .retries(2)
  .build();
```

Use low temperature for extraction unless the provider has a specific recommendation. Extraction is a reliability workflow, not a creative writing workflow.

## Failure Handling

Handle `ExtractionError` at the runner boundary:

```ts
import { ExtractionError } from "@anvia/core/extractor";

try {
  return await ticketExtractor.extract(noteText);
} catch (error) {
  if (error instanceof ExtractionError) {
    return {
      status: "needs_review",
      reason: "ticket_extraction_failed",
    };
  }

  throw error;
}
```

The original cause is available on the error. Keep the product response stable and log the detailed cause in your observability system.

## Extractors Versus Other Structured Output

Choose by what the model is doing.

Use `createParsedCompletion(...)` when the prompt asks the model to produce a new structured answer. The schema is the final answer shape.

```ts
const classification = await createParsedCompletion(model, {
  schema: ticketClassificationSchema,
  input: "Classify this ticket: I cannot update my card.",
});
```

Use `ExtractorBuilder` when the content already exists and the model's job is to pull fields out of it. The schema is the record shape to extract from the supplied text.

```ts
const ticket = await ticketExtractor.extract(`
  Customer: Acme Co.
  Message: Checkout is unavailable for enterprise users.
  Impact: Missed orders after payment retries failed.
`);
```

Use `.outputSchema(...)` when an agent has a broader runtime loop and its final response should be structured. That is the right fit when the agent may use tools, memory, context, hooks, or multiple turns before producing the final object.

Use a pipeline when extraction is one stage inside a larger workflow. Put deterministic preparation and routing in steps, and keep the extractor focused on extracting fields:

```ts
const ticketPipeline = new PipelineBuilder(z.string())
  .step((note) => note.trim().replace(/\s+/g, " "))
  .extract(ticketExtractor)
  .step((ticket) => ({
    ...ticket,
    route: ticket.priority === "high" ? "incident" : "support",
  }))
  .build();
```

The practical rule: use parsed completion for direct structured answers, use an extractor for field extraction from supplied content, use agent output schema for structured agent results, and use a pipeline when extraction is part of a multi-step product workflow.
