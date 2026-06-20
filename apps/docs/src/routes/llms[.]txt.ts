import { createFileRoute } from "@tanstack/react-router";

const llmsTxt = `# Anvia

> TypeScript runtime for building provider-agnostic agents and application-owned AI workflows.

Anvia helps teams build agents, typed tools, structured output, retrieval, pipelines, streaming, observability, MCP integrations, local skills, and Studio inspection without giving up ownership of app data, permissions, side effects, storage, or deployment.

Use this file as the compact agent-facing map. Use [Full AI Context](/llms-full.txt) when you need the complete documentation body.

## Core Mental Model

Most Anvia workflows use the same ownership split:

- Provider clients own credentials, base URLs, and provider SDK wiring.
- Models expose reusable completion or embedding capability.
- Agents own stable runtime identity, instructions, tools, defaults, hooks, and observers.
- Prompt requests own user input, history, sessions, traces, limits, and per-run tool behavior.
- Tools own application behavior, permissions, side effects, and expected product states.
- Pipelines own explicit multi-step composition when one prompt is not enough.

Primary docs:

- [Introduction](/docs/guides): SDK overview and core primitives.
- [Best Practices](/docs/best-practices): Pattern library for production harnesses, coding agents, RAG, evals, tracing, dynamic tool catalogs, MCP servers, validation, side-effect tools, real cases, guardrails, and operations.
- [How Anvia Works](/docs/guides/sdk-fundamentals/runtime-boundaries): Responsibility boundaries.
- [Provider Clients and Models](/docs/guides/sdk-fundamentals/clients-and-models): Configure provider access and reusable model capabilities.
- [Prompt Requests](/docs/guides/sdk-fundamentals/prompt-requests): How prompts become normalized model requests.
- [Prompt Responses](/docs/guides/sdk-fundamentals/prompt-responses): Output, usage, trace info, and new messages.

## Learning Path: Build an Agent

Use this when you want a promptable runtime with clear instructions and a stable runtime id.

Goal:

- Create a provider client.
- Create a reusable completion model.
- Build an agent with instructions.
- Send one prompt and receive a final response.

Path:

1. [Getting Started](/docs/guides/getting-started): Install Anvia and run a complete first agent.
2. [How Anvia Works](/docs/guides/sdk-fundamentals/runtime-boundaries): Learn which object owns which responsibility.
3. [Provider Clients and Models](/docs/guides/sdk-fundamentals/clients-and-models): Choose provider client and model.
4. [Creating Agents](/docs/guides/agents/creating-agents): Configure identity, instructions, and runtime behavior.
5. [Prompt Requests](/docs/guides/sdk-fundamentals/prompt-requests): Understand \`agent.prompt(...).send()\`.

Minimal agent flow:

1. Install the runtime and a provider adapter.
2. Create a provider client.
3. Create a reusable completion model.
4. Build an agent with stable instructions.
5. Run \`agent.prompt(...).send()\` from application code.

\`\`\`ts
import { AgentBuilder } from "@anvia/core";
import { OpenAIClient } from "@anvia/openai";

const client = new OpenAIClient({ apiKey });
const model = client.completionModel("gpt-5.5");

const agent = new AgentBuilder("support", model)
  .instructions("Answer support questions clearly.")
  .build();

const response = await agent.prompt("How do I reset my password?").send();

console.log(response.output);
\`\`\`

Add next:

- [Persist Conversations](/docs/guides/learning-paths/persist-conversations): Store and replay message history.
- [Add Tools](/docs/guides/learning-paths/add-tools): Let agents call typed application behavior.
- [Return Structured Output](/docs/guides/learning-paths/return-structured-output): Return schema-shaped data.
- [Streaming Events](/docs/guides/streaming/streaming-events): Stream incremental events.

## Learning Path: Add Tools

Use this when the model needs to inspect data, call services, or perform actions owned by your application.

Goal:

- Define a Zod-backed tool.
- Register it on an agent.
- Keep turn limits low.
- Keep permission checks inside tool code.

Path:

1. [Creating Tools](/docs/guides/tools/creating-tools): Define tools with input validation.
2. [Tool Schemas](/docs/guides/tools/tool-schemas): Understand how schemas become provider tool definitions.
3. [Agent Tools](/docs/guides/agents/agent-tools): Register tools on agents.
4. [Tool Results](/docs/guides/tools/tool-results): Understand what is sent back to the model.
5. [Tool Errors](/docs/guides/tools/tool-errors): Decide when to return expected states and when to throw.

Minimal shape:

\`\`\`ts
import { AgentBuilder, createTool } from "@anvia/core";
import { OpenAIClient } from "@anvia/openai";
import { z } from "zod";

const lookupOrder = createTool({
  name: "lookup_order",
  description: "Look up an order by order id.",
  input: z.object({
    orderId: z.string(),
  }),
  async execute({ orderId }) {
    return { orderId, status: "shipped" };
  },
});

const model = new OpenAIClient({ apiKey }).completionModel("gpt-5.5");

const agent = new AgentBuilder("support", model)
  .instructions("Use tools when order status is needed.")
  .tool(lookupOrder)
  .defaultMaxTurns(3)
  .build();
\`\`\`

Production notes:

- Enforce auth, tenant checks, and permissions inside tool code.
- Return explicit expected states such as \`not_found\` or \`blocked\`.
- Throw only when the workflow should fail or be retried.
- Use [Human in the Loop](/docs/guides/human-in-the-loop) for guarded actions.
- Use [Tool Sets](/docs/guides/tools/tool-sets) when many tools need shared filtering or metadata.
- Use [Server Tools](/docs/guides/mcp/server-tools) when tools come from MCP servers.

## Learning Path: Persist Conversations

Use this when an agent needs previous turns.

Goal:

- Understand the \`Message[]\` history shape.
- Pass explicit transcripts into prompts.
- Use durable session memory when appropriate.
- Append \`response.messages\` after each run.

Path:

1. [Messages and History](/docs/guides/sdk-fundamentals/messages-and-history): Raw message shape.
2. [Prompt Responses](/docs/guides/sdk-fundamentals/prompt-responses): \`response.messages\`, usage, and trace fields.
3. [Memory and Sessions](/docs/guides/sdk-fundamentals/memory-and-sessions): Core-managed durable conversations.
4. [Memory](/docs/guides/memory): Raw SQL, Prisma, and Drizzle storage adapters.
5. [Agent History](/docs/guides/agents/agent-history): Agent-specific history examples.

Minimal shape:

\`\`\`ts
import { Message } from "@anvia/core";

const history = await conversations.loadMessages(conversationId);
const currentPrompt = Message.user(userInput);

const response = await agent.prompt([...history, currentPrompt]).send();

await conversations.saveMessages(conversationId, [
  ...history,
  ...response.messages,
]);
\`\`\`

Core-managed session shape:

\`\`\`ts
const response = await agent.session(conversationId).prompt(userInput).send();
\`\`\`

Key rule: \`response.messages\` is only the new part of the run. Append it to the history you loaded if you want a full transcript.

## Learning Path: Return Structured Output

Use this when application code needs JSON-shaped data it can validate before use.

Goal:

- Define schemas with Zod.
- Use agent output schemas for typed final responses.
- Use extractors for schema-first extraction from existing text.
- Handle validation and retry failures deliberately.

Path:

1. [Schemas](/docs/guides/structured-output/schemas): Define target shapes.
2. [Zod Schema](/docs/guides/structured-output/zod-schema): Schema conversion behavior.
3. [Agent Output](/docs/guides/structured-output/agent-output): Structured final agent responses.
4. [Extractors](/docs/guides/structured-output/extractors): Convert existing text into typed data.
5. [Output Validation](/docs/guides/structured-output/output-validation): Validate before product use.
6. [Failure Handling](/docs/guides/structured-output/failure-handling): Retry, report, or fail cleanly.

Choosing the primitive:

- Use agent output schema when the agent should produce typed final output.
- Use an extractor when existing text should become typed data.
- Use an extractor step when a pipeline should normalize data.
- Use tool output validation when tool results need a contract.

Agent output shape:

\`\`\`ts
import { AgentBuilder } from "@anvia/core";
import { OpenAIClient } from "@anvia/openai";
import { z } from "zod";

const model = new OpenAIClient({ apiKey }).completionModel("gpt-5.5");

const agent = new AgentBuilder("classifier", model)
  .instructions("Classify support messages.")
  .outputSchema(
    z.object({
      category: z.enum(["billing", "technical", "account"]),
      confidence: z.number(),
    }),
  )
  .build();

const response = await agent.prompt("I cannot update my payment method.").send();
\`\`\`

Extractor shape:

\`\`\`ts
import { ExtractorBuilder } from "@anvia/core/extractor";
import { z } from "zod";

const ticketSchema = z.object({
  customer: z.string(),
  priority: z.enum(["low", "medium", "high"]),
  summary: z.string(),
});

const extractor = new ExtractorBuilder(model, ticketSchema)
  .instructions("Extract support ticket fields.")
  .retries(1)
  .build();

const ticket = await extractor.extract("Acme Co. has urgent checkout failures.");
\`\`\`

## Learning Path: Build a Pipeline

Use this when one prompt is not enough and the workflow needs explicit testable steps.

Goal:

- Create a pipeline.
- Add transform steps.
- Call agents from pipelines.
- Run extractors.
- Add parallel branches when independent work can run side by side.

Path:

1. [Pipeline Builder](/docs/guides/pipelines/pipeline-builder): Core API.
2. [Steps](/docs/guides/pipelines/steps): Ordinary transform steps.
3. [Prompt Steps](/docs/guides/pipelines/prompt-steps): Call agents.
4. [Extractor Steps](/docs/guides/pipelines/extractor-steps): Return typed data.
5. [Parallel Branches](/docs/guides/pipelines/parallel-branches): Run independent work side by side.
6. [Composition Patterns](/docs/guides/pipelines/composition-patterns): Larger workflows.

Use a pipeline for named stages such as normalize input, ask an agent, extract fields, enrich with app data, run parallel checks, and return a final object. Do not use a pipeline just to send one prompt.

Minimal shape:

\`\`\`ts
import { PipelineBuilder } from "@anvia/core/pipeline";
import { z } from "zod";

const TicketInput = z.object({
  customer: z.string(),
  subject: z.string(),
  body: z.string(),
});

const pipeline = new PipelineBuilder(TicketInput)
  .step((ticket) => ({
    customer: ticket.customer.trim(),
    subject: ticket.subject.trim(),
    body: ticket.body.trim(),
  }))
  .step((ticket) => ({
    title: ticket.subject.toLowerCase(),
    customer: ticket.customer,
    words: ticket.body.split(/\\s+/).length,
  }))
  .build();

const result = await pipeline.run({
  customer: " Acme Co. ",
  subject: " Checkout is failing ",
  body: "Enterprise checkout fails after payment retries.",
});
\`\`\`

Agent and extractor pipeline shape:

\`\`\`ts
const pipeline = new PipelineBuilder(TicketInput)
  .step((ticket) =>
    [
      "Customer: " + ticket.customer,
      "Subject: " + ticket.subject,
      "Body: " + ticket.body,
    ].join("\\n"),
  )
  .prompt(summarizer)
  .extract(extractor)
  .build();
\`\`\`

## Learning Path: Add Retrieval

Use this when an agent needs searchable knowledge that should not be placed directly in static instructions.

Goal:

- Choose an embedding model.
- Embed documents.
- Store vectors.
- Filter results.
- Attach retrieved context to an agent run.

Path:

1. [Embeddings](/docs/guides/retrieval/embeddings): Choose an embedding model.
2. [Embed Documents](/docs/guides/retrieval/embed-documents): Convert text into vectors.
3. [Vector Stores](/docs/guides/retrieval/vector-stores): Store and search embeddings.
4. [RAG Context](/docs/guides/retrieval/rag-context): Attach retrieved documents to agents.
5. [Metadata Filters](/docs/guides/retrieval/metadata-filters): Respect tenant, user, or document filters.
6. [LSH](/docs/guides/retrieval/lsh): Narrow local search candidates.

Use static context when the text is short, global, and stable. Use retrieval when the knowledge base is large, filtered, refreshed, or prompt-dependent.

Preprocess shape:

\`\`\`ts
import { embedDocuments } from "@anvia/core/embeddings";
import { InMemoryVectorStore } from "@anvia/core/vector-store";
import { OpenAIClient } from "@anvia/openai";

const client = new OpenAIClient({ apiKey });
const embeddings = client.embeddingModel("text-embedding-3-small");

const documents = [
  {
    id: "password-reset",
    title: "Password reset policy",
    body: "Password reset links expire after 30 minutes.",
  },
];

const embedded = await embedDocuments(embeddings, documents, {
  id: (doc) => doc.id,
  content: (doc) => doc.title + "\\n" + doc.body,
  metadata: (doc) => ({ title: doc.title }),
});

export const supportDocs = InMemoryVectorStore.fromDocuments(embedded);
export const supportDocsIndex = supportDocs.index(embeddings);
\`\`\`

Runtime retrieval shape:

\`\`\`ts
const agent = new AgentBuilder("support", model)
  .instructions("Use retrieved context when answering.")
  .dynamicContext(supportDocsIndex, {
    topK: 2,
    format: (result) => ({
      id: result.id,
      text: result.document.title + "\\n" + result.document.body,
    }),
  })
  .build();

const response = await agent.prompt("How long does a reset link last?").send();
\`\`\`

Search tool shape:

\`\`\`ts
const searchDocs = supportDocsIndex.asTool({
  name: "search_docs",
  description: "Search support documentation.",
});

const agent = new AgentBuilder("support", model)
  .tool(searchDocs)
  .defaultMaxTurns(3)
  .build();
\`\`\`

Production notes:

- Persist vectors in a durable vector store for production.
- Filter retrieval by tenant, user, document ownership, or product policy where needed.
- Keep retrieved context concise and cite document ids or titles when useful.

## Learning Path: Add Observability

Use this when you need to inspect what happened during an agent run.

Goal:

- Observe prompt run start and end.
- Observe model generation requests and responses.
- Observe tool calls and tool results.
- Capture usage data and trace metadata.

Path:

1. [Observers](/docs/guides/observability/observers): Attach runtime observers.
2. [Trace Groups](/docs/guides/observability/trace-groups): Group related work.
3. [Tracing](/docs/guides/observability/tracing): Trace metadata and integrations.
4. [Langfuse](/docs/guides/observability/langfuse): Send traces to Langfuse.
5. [Streaming Events](/docs/guides/streaming/streaming-events): Stream live UI events.
6. [Prompt Responses](/docs/guides/sdk-fundamentals/prompt-responses): Response usage and trace fields.

Log first:

- agent id
- prompt run id or conversation id
- model name
- total tokens
- tool names called
- error type and message
- trace id when available

Minimal trace shape:

\`\`\`ts
const response = await agent
  .prompt("How do I reset my password?")
  .withTrace({
    name: "support-question",
    userId: "user_123",
    metadata: { surface: "docs-example" },
  })
  .send();

console.log(response.usage.totalTokens);
console.log(response.trace);
\`\`\`

Do not log sensitive prompt, document, or tool data unless your product policy allows it.

## Learning Path: Prepare for Production

Use this when an Anvia workflow moves from prototype to product code.

Checklist:

- Providers: create clients and models once, configure keys through your secret system.
- Tools: enforce auth and permissions inside tool code.
- History: persist \`Message[]\` and append \`response.messages\`.
- Turn limits: keep limits low enough to prevent unbounded tool loops.
- Structured output: validate output before using it in product workflows.
- Retrieval: filter by tenant, user, or document ownership when needed.
- Observability: log run metadata, usage, tool calls, errors, and trace ids.
- Errors: classify setup, provider, validation, tool, cancellation, and runtime-limit failures.
- Testing: cover tools, deterministic pipeline steps, retrieval filters, and Studio routes before broad provider tests.

Path:

1. [How Anvia Works](/docs/guides/sdk-fundamentals/runtime-boundaries): Confirm ownership.
2. [Errors and Cancellation](/docs/guides/sdk-fundamentals/errors): Plan failure handling.
3. [Human in the Loop](/docs/guides/human-in-the-loop): Guard side-effect actions.
4. [Messages and History](/docs/guides/sdk-fundamentals/messages-and-history): Persistence shape.
5. [Output Validation](/docs/guides/structured-output/output-validation): Typed workflow safety.
6. [Observers](/docs/guides/observability/observers): Runtime visibility.
7. [Testing](/docs/guides/testing): Verification boundaries.

Deployment shape:

- Startup-owned: provider clients, model instances, reusable agents, tools, pipelines, durable stores, connection registries.
- Request-owned: user input, stored history, trace metadata, session ids, request-specific limits, hooks, and authorization context.

Wrapper shape:

\`\`\`ts
import { type AgentBuilder, MaxTurnsError, Message, PromptCancelledError } from "@anvia/core";

type Agent = ReturnType<AgentBuilder["build"]>;

export async function runSupportAgent(agent: Agent, options: RunSupportAgentOptions) {
  try {
    const response = await agent
      .prompt([...options.history, Message.user(options.input)])
      .withTrace({
        name: "support-agent",
        userId: options.userId,
        sessionId: options.conversationId,
      })
      .maxTurns(3)
      .send();

    await conversations.saveMessages(options.conversationId, [
      ...options.history,
      ...response.messages,
    ]);

    await usageEvents.record({
      userId: options.userId,
      totalTokens: response.usage.totalTokens,
      traceId: response.trace?.traceId,
    });

    return response.output;
  } catch (error) {
    if (error instanceof MaxTurnsError) return "I need fewer steps to finish this.";
    if (error instanceof PromptCancelledError) return "The request was cancelled.";
    throw error;
  }
}
\`\`\`

## Feature Map

- [Agents](/docs/guides/agents/creating-agents): Promptable runtime with instructions, tools, context, history, hooks, limits, and output schemas.
- [Tools](/docs/guides/tools/creating-tools): Typed application-owned behavior callable by models.
- [Messages and History](/docs/guides/sdk-fundamentals/messages-and-history): Multi-turn conversation state and provider-neutral messages.
- [Structured Output](/docs/guides/structured-output/schemas): Schema-shaped responses, extractors, validation, and failure handling.
- [Pipelines](/docs/guides/pipelines/pipeline-builder): Compose functions, agents, extractors, batches, and parallel branches.
- [Retrieval](/docs/guides/retrieval/embeddings): Embeddings, document ingestion, vector stores, RAG context, and metadata filters.
- [Human in the Loop](/docs/guides/human-in-the-loop): Tool approvals, human questions, and guarded side effects.
- [MCP](/docs/guides/mcp/connections): Connect Model Context Protocol servers and expose their tools.
- [Streaming](/docs/guides/streaming/streaming-events): Incremental text, reasoning, tool, and final response events.
- [Observability](/docs/guides/observability/observers): Run, generation, tool, usage, score, and trace events.
- [Skills](/docs/guides/skills/local-skills): Load reusable instruction and tool bundles.
- [Studio](/docs/studio/overview): Inspect local agents, sessions, traces, approvals, questions, and run streams.
- [Models](/docs/models): Provider adapters, compatible gateways, embeddings, and model listing.
- [Reference](/docs/reference): Public API exports, types, constructors, and package coverage.

## Reference

- [Full AI Context](/llms-full.txt): Complete documentation in one text file.
- [Guides](/docs/guides): Concepts, learning paths, and production workflows.
- [Learning Paths](/docs/guides/learning-paths/build-an-agent): Task-oriented path from first agent to production workflow.
- [Models](/docs/models): Provider adapters, compatible gateways, embeddings, and model listing.
- [Reference](/docs/reference): Public API exports, types, constructors, and package coverage.
`;

export const Route = createFileRoute("/llms.txt")({
  server: {
    handlers: {
      GET: async () =>
        new Response(llmsTxt, {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
          },
        }),
    },
  },
});
