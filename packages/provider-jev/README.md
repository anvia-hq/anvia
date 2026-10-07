# @anvia/jev

Use Jev for typed decisions in ordinary applications: classification, tagging, routing,
prioritization, record matching, and verification. Create a decision model and pass it to
Anvia's provider-neutral `decide()` operation.

## Install

```sh
pnpm add @anvia/jev @anvia/core
```

The adapter uses the official `@typesafe-ai/sdk` and requires Node.js 20 or newer.

## Quickstart

Set `TYPESAFE_API_KEY` in your server environment.

```ts
import { JevClient, JEV_LATEST } from "@anvia/jev";
import { choice, decide } from "@anvia/core/decision";

const client = new JevClient({ apiKey: process.env.TYPESAFE_API_KEY });
const model = client.decisionModel({ modelId: JEV_LATEST });

const { answers } = await decide({
  model,
  state: { message: "Please refund my duplicate payment." },
  questions: {
    department: choice({
      instructions: "Which department should handle this?",
      options: {
        billing: "Payments, invoices, and refunds",
        technical: "Product bugs and technical support",
        general: "Other requests",
      },
    }),
  },
});

console.log(answers.department.choice); // "billing" | "technical" | "general"
console.log(answers.department.confidence);
```

## Capabilities

- Native choice, rubric score, and boolean probability questions.
- Multiple labels composed from one independent Noul question per label in the same request.
- Mixed questions, normalized token usage, and the original SDK result in `rawResponse`.
- Model listing, custom endpoints, headers, and an injected `TypeSafeClient`.
- Core-controlled retries, cancellation, and ordered batch execution.

## Learn more

- [Jev usage guide](../../docs/packages/provider-jev.md)
- [Decision API guide](../../docs/packages/decision.md)
- [Official TypeSafe documentation](https://docs.typesafe.ai/)
