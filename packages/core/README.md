# @anvia/core

Build provider-independent AI agents and workflows with typed tools, streaming, structured output,
and application-owned memory. Core runs the model/tool loop while your application chooses providers,
credentials, storage, and delivery.

## Install

```sh
pnpm add @anvia/core @anvia/openai zod
```

This example uses OpenAI. Other provider adapters work with the same Core APIs.

## Quickstart

Set `OPENAI_API_KEY` in your server environment, then create an agent with a typed tool:

```ts
import { Agent, createTool } from "@anvia/core";
import { OpenAIClient } from "@anvia/openai";
import { z } from "zod";

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error("Set OPENAI_API_KEY.");
const client = new OpenAIClient({ apiKey });
const lookupOrder = createTool({
  name: "lookup_order",
  description: "Look up an order by ID.",
  inputSchema: z.object({ orderId: z.string() }),
  execute: async ({ orderId }) => ({ orderId, status: "processing" }),
});

const agent = new Agent({
  id: "support",
  model: client.completionModel({ modelId: "gpt-5", api: "responses" }),
  instructions: "Help customers with order questions.",
  tools: [lookupOrder],
  maxTurns: 4,
});

const result = await agent.generate({ prompt: "What is happening with order A123?" });
if (result.type === "response") console.log(result.output);
```

Replace the sample tool body with your application's data access. Agent outcomes distinguish a
response, a guardrail block, and an interaction that needs application input.

## What you can build

- Agents with typed tools, approvals, questions, guardrails, and streaming responses.
- Agent teams with isolated conversations, delegation, and coordinated cancellation.
- Direct completions and schema-validated extraction without an agent loop.
- [Typed decisions](../../docs/packages/decision.md) for classification, tagging, scoring, and routing.
- Sequential or parallel pipelines and evaluations with built-in or custom metrics.
- Stateful conversations using memory adapters and explicit compaction policies.
- RAG with document chunking, embeddings, and vector-store contracts.
- Image generation, speech, transcription, MCP tools, and local Agent Skills.

Use `@anvia/client`, `@anvia/server`, and `@anvia/react` to deliver agent output to an application UI.
Use provider, memory, vector-store, and observability adapters for the infrastructure you choose.

Streaming completions preserve empty or encrypted reasoning supplied only in the final provider
response, including Azure Responses streams. Final encrypted details can also enrich matching
streamed reasoning for replay on subsequent turns. Conflicting text, reasoning, and tool calls still
fail provider output validation.

For recoverable execution, register a supported agent with the experimental
[`@anvia/durable`](../durable/README.md) runtime. Durable tools receive an optional stable
`ToolCallContext.operationId` for external idempotency. Direct execution does not supply it.
Durable registrations can opt into persisted streaming with `stream: true`; core execution
protocol version 2 checkpoints validated streamed completions alongside tool results.

## Learn more

- [Core guide and API examples](https://github.com/anvia-hq/anvia/blob/main/docs/packages/core.md)
- [Runnable cookbook](https://github.com/anvia-hq/anvia/tree/main/cookbook)
- [Package catalog](https://github.com/anvia-hq/anvia#readme)
- [Contributing](https://github.com/anvia-hq/anvia/blob/main/CONTRIBUTING.md)
