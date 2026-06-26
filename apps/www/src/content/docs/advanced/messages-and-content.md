---
title: Completions, messages, and content
description: Make direct completions, messages, documents, reasoning, and tool content model-readable.
section: advanced
sidebar:
  group: Production architecture
  order: 7
  label: Completions
---

Completions are the lowest-level text-generation workflow in `@anvia/core`. Use them when you want one provider call without agent turns, memory, dynamic context, or tool execution.

Agents build on the same message and content contracts, so understanding completions helps with history, documents, multimodal input, reasoning content, tool calls, and tool results.

## Direct Completion

```ts
import { createCompletion } from "@anvia/core";

const result = await createCompletion(model, {
  instructions: "Answer in one concise paragraph.",
  input: "Summarize the incident report.",
  maxTokens: 300,
});

console.log(result.text);
```

Use direct completions for summarization, classification, rewriting, single-step generation, and small internal utilities. They are also useful for testing provider credentials before adding agents, tools, memory, or streaming.

## Transcript Ownership

Conversation history belongs in memory. Configure a memory store on the agent and run turns through a session:

```ts
const response = await agent
  .session("thread_123", { userId: "user_456" })
  .prompt("Explain this error.")
  .send();
```

With a session, core loads prior messages through `MemoryStore.load`, runs the new turn, and appends runtime messages according to the configured save policy. Your app still owns the storage implementation, retention policy, tenant checks, and any audit records around the run.

The message objects stored by memory still matter. System messages describe stable behavior, user messages carry user input, assistant messages carry model responses and tool calls, and tool messages carry results returned after a tool call. The application should expose those through a `MemoryStore` implementation instead of rebuilding history at the prompt call site.

## Content Types

Messages can include more than plain text when the provider model supports it, but each role has its own content contract:

- user messages can contain text, images, and documents
- assistant messages can contain text, images, reasoning content, and tool calls
- tool messages contain tool results

Only enable non-text content after checking that the selected provider model supports it. A model that handles image input may still have different constraints for document input or tool calls.

Use [Models and capabilities](/docs/advanced/models-and-capabilities) before enabling non-text content in production.

Use the exported helpers when constructing messages directly:

```ts
import { Message, UserContent } from "@anvia/core";

const prompt = Message.user([
  UserContent.text("Summarize the attached incident report."),
  UserContent.documentUrl("https://files.example.com/incidents/123.txt", "text/plain", {
    filename: "incident-123.txt",
  }),
]);
```

These helpers keep the role/content split explicit. Documents belong on user messages, tool results belong on tool messages, and reasoning content belongs on assistant messages.

## Completion API Helpers

The high-level `createCompletion(...)`, `createCompletionStream(...)`, and `createParsedCompletion(...)` helpers are enough for most application code. The lower-level `CompletionRequestBuilder` is available from `@anvia/core/completion` when integration code needs to build the provider-neutral `CompletionRequest` step by step.

Useful completion exports include:

- `ToolChoice` for `"auto"`, `"required"`, `"none"`, or forcing a named function tool
- `UserContent`, `AssistantContent`, `ToolContent`, and `Message` for constructing typed transcripts
- `Usage.empty()` and `Usage.add(...)` for aggregating token usage
- `CompletionCapabilityError` and `assertCompletionRequestSupported(...)` for fail-fast capability checks
- `textFromAssistantContent(...)` and `reasoningDisplayText(...)` for turning structured assistant content into display text

## Documents

Documents are named text blocks passed alongside a completion request or agent context:

```ts
await createCompletion(model, {
  input: "What changed?",
  documents: [{ id: "release-notes", text: releaseNotes }],
});
```

Use documents for small, relevant text blocks that should accompany one request. For file and PDF ingestion, use [Loaders](/docs/advanced/loaders) before passing text into completions, embeddings, or RAG context.

Do not use direct completion documents as a substitute for retrieval when the knowledge base is large or frequently changing. Use retrieval to select relevant documents first.

## Tool Calls In History

Agent runs can produce assistant tool-call messages and tool-result messages. Memory-backed sessions preserve those messages through the configured `MemoryStore`, so future prompts can understand what already happened. If you store only the final answer, the next run may ask for the same tool again because the transcript no longer includes the prior tool result.

When a tool result includes private data, apply the same retention and redaction policy you use for product logs.

## Reasoning And Provider Metadata

Some providers can return reasoning content or provider-specific metadata. Treat that content as operational data, not always as user-facing text. It can be useful for debugging, evaluation, and traces, but it may also include details you do not want to persist forever.

Decide separately what is stored for conversation continuity, what is sent to observability, and what is shown to users. A final answer can be user-visible while tool results and reasoning summaries remain internal.

## Streaming Content

Direct completion streams emit model-level events. Agent streams emit runtime events across the whole agent run, including turns, text deltas, tool calls, tool results, nested agent events, final output, and errors.

Choose the stream level based on the UI. A simple text box may only need text deltas and final output. An internal operations UI may want tool call and trace events. A production user UI usually needs filtered events so private tool details do not leak.

## Direct Completion Or Agent

Use a direct completion for one model call with no tools or agent loop. Use a parsed completion when the response must be schema-validated JSON. Move to an agent when the workflow needs tools, memory, dynamic context, hooks, observers, or turn limits.

Use an extractor for repeated structured extraction. Use a pipeline when the workflow has multiple deterministic and model-driven steps.

Keep direct completions close to the application code that owns the input and output shape.
