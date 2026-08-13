import { describe, expect, expectTypeOf, it } from "vitest";
import type {
  AgentContextInput,
  AgentOptions,
  AgentToolInput,
  ContextIndex,
  CreateContextIndexOptions,
  AgentErrorStreamEvent as PublicAgentErrorStreamEvent,
  AgentSession as PublicAgentSessionType,
  AgentStreamEvent as PublicAgentStreamEvent,
  AgentStreamEventWithoutToolCallDeltas as PublicAgentStreamEventWithoutToolCallDeltas,
  AgentStreamEventWithToolCallDeltas as PublicAgentStreamEventWithToolCallDeltas,
  AgentStreamOptions as PublicAgentStreamOptions,
  AgentToolCallDeltaEvent as PublicAgentToolCallDeltaEvent,
  Agent as PublicAgentType,
  RetryContext as PublicRetryContext,
  RetryOptions as PublicRetryOptions,
} from "../src/agent";
import * as publicAgent from "../src/agent";
import * as audioGeneration from "../src/audio-generation";
import * as completion from "../src/completion";
import * as embeddings from "../src/embeddings";
import * as evals from "../src/evals";
import * as extractor from "../src/extractor";
import * as guardrails from "../src/guardrails";
import * as hooks from "../src/hooks";
import * as imageGeneration from "../src/image-generation";
import type {
  AgentErrorStreamEvent as RootAgentErrorStreamEvent,
  AgentStreamEvent as RootAgentStreamEvent,
  AgentStreamEventWithoutToolCallDeltas as RootAgentStreamEventWithoutToolCallDeltas,
  AgentStreamEventWithToolCallDeltas as RootAgentStreamEventWithToolCallDeltas,
  AgentStreamOptions as RootAgentStreamOptions,
  AgentToolCallDeltaEvent as RootAgentToolCallDeltaEvent,
  RetryContext as RootRetryContext,
  RetryOptions as RootRetryOptions,
  ToolContent as RootToolContentType,
} from "../src/index";
import * as publicCore from "../src/index";
import { Message as RootMessage, ToolContent as RootToolContent, Usage } from "../src/index";
import * as internalAgent from "../src/internal/agent";
import * as loaders from "../src/loaders";
import * as mcp from "../src/mcp";
import * as memory from "../src/memory";
import * as modelListing from "../src/model-listing";
import * as observability from "../src/observability";
import * as pipeline from "../src/pipeline";
import * as skills from "../src/skills";
import * as streaming from "../src/streaming";
import * as tool from "../src/tool";
import * as transcription from "../src/transcription";
import * as ui from "../src/ui";
import * as vectorStore from "../src/vector-store";

describe("public exports", () => {
  it("exposes public agent type exports", () => {
    expectTypeOf<AgentOptions>().not.toBeNever();
    expectTypeOf<PublicAgentType>().not.toBeNever();
    expectTypeOf<PublicAgentSessionType>().not.toBeNever();
    expectTypeOf<AgentContextInput>().not.toBeNever();
    expectTypeOf<ContextIndex>().not.toBeNever();
    expectTypeOf<CreateContextIndexOptions>().not.toBeNever();
    expectTypeOf<AgentToolInput>().not.toBeNever();
  });

  it("does not expose the removed AgentBuilder", () => {
    expect("AgentBuilder" in publicCore).toBe(false);
    expect("AgentBuilder" in publicAgent).toBe(false);
  });

  it("exposes context index helpers from the public entrypoints", () => {
    expect("createContextIndex" in publicCore).toBe(true);
    expect("createContextIndex" in publicAgent).toBe(true);
    expect("isContextIndex" in publicCore).toBe(true);
    expect("isContextIndex" in publicAgent).toBe(true);
  });

  it("exposes middleware helpers from public entrypoints", () => {
    expect("createMiddleware" in publicCore).toBe(true);
    expect("createToolMiddleware" in publicCore).toBe(false);
    expect("createMiddleware" in publicAgent).toBe(false);
    expect("createToolMiddleware" in publicAgent).toBe(false);
    expect("createMiddleware" in tool).toBe(true);
    expect("createToolMiddleware" in tool).toBe(false);
  });

  it("exposes runtime Agent but keeps AgentSession type-only", () => {
    expect("Agent" in publicCore).toBe(true);
    expect("Agent" in publicAgent).toBe(true);
    expect("AgentSession" in publicAgent).toBe(false);
  });

  it("exposes runtime Agent through the internal agent entrypoint", () => {
    expect("Agent" in internalAgent).toBe(true);
    expect("AgentSession" in internalAgent).toBe(true);
  });

  it("exposes agent run errors from the public agent entrypoint", () => {
    expect("createHook" in publicAgent).toBe(false);
    expect("skipTool" in publicAgent).toBe(false);
    expect("AgentRunCancelledError" in publicAgent).toBe(true);
    expect("MaxTurnsError" in publicAgent).toBe(true);
    expect("ToolApprovalRequiredError" in publicAgent).toBe(false);
  });

  it("keeps controlling hooks internal", () => {
    expect("createHook" in publicCore).toBe(false);
    expect("createHook" in hooks).toBe(true);
    expect("createHook" in internalAgent).toBe(true);
    expect("skipTool" in hooks).toBe(true);
  });

  it("exposes agent run contracts from root and agent entrypoints", () => {
    expectTypeOf<RootRetryContext>().toEqualTypeOf<PublicRetryContext>();
    expectTypeOf<RootRetryOptions>().toEqualTypeOf<PublicRetryOptions>();
    expectTypeOf<RootAgentErrorStreamEvent>().toEqualTypeOf<PublicAgentErrorStreamEvent>();
    expectTypeOf<RootAgentStreamOptions>().toEqualTypeOf<PublicAgentStreamOptions>();
    expectTypeOf<RootAgentToolCallDeltaEvent>().toEqualTypeOf<PublicAgentToolCallDeltaEvent>();
    expectTypeOf<RootAgentStreamEvent>().toEqualTypeOf<PublicAgentStreamEvent>();
    expectTypeOf<RootAgentStreamEventWithoutToolCallDeltas>().toEqualTypeOf<PublicAgentStreamEventWithoutToolCallDeltas>();
    expectTypeOf<RootAgentStreamEventWithToolCallDeltas>().toEqualTypeOf<PublicAgentStreamEventWithToolCallDeltas>();
    expectTypeOf<
      Extract<PublicAgentStreamEvent, { type: "tool_call_delta" }>
    >().toEqualTypeOf<PublicAgentToolCallDeltaEvent>();
    expectTypeOf<
      Extract<PublicAgentStreamEventWithoutToolCallDeltas, { type: "tool_call_delta" }>
    >().toBeNever();
    expectTypeOf<PublicAgentStreamEventWithToolCallDeltas>().toEqualTypeOf<PublicAgentStreamEvent>();
    expectTypeOf<
      Extract<PublicAgentStreamEvent, { type: "error" }>
    >().toEqualTypeOf<PublicAgentErrorStreamEvent>();

    const errorEvent: PublicAgentErrorStreamEvent = {
      type: "error",
      error: new Error("failed"),
      usage: Usage.empty(),
    };
    expect(errorEvent.usage).toEqual(Usage.empty());

    // @ts-expect-error Agent runtime error events require cumulative usage.
    const missingUsage: PublicAgentErrorStreamEvent = { type: "error", error: "failed" };
    void missingUsage;
  });

  it("does not expose removed experimental UI stream creators", () => {
    expect("createCompletionUIStream" in publicCore).toBe(false);
    expect("createAgentUIStream" in publicCore).toBe(false);
    expect("completionStreamToUIStream" in publicCore).toBe(false);
    expect("agentStreamToUIStream" in publicCore).toBe(false);
    expect("createCompletionUIStream" in ui).toBe(false);
    expect("createAgentUIStream" in ui).toBe(false);
    expect("completionStreamToUIStream" in ui).toBe(false);
    expect("agentStreamToUIStream" in ui).toBe(false);
  });

  it("keeps public subpath runtime exports available", () => {
    expect(hooks).toHaveProperty("createHook");
    expect(audioGeneration).toHaveProperty("generateSpeech");
    expect(audioGeneration).not.toHaveProperty("audioGenerationRequest");
    expect(audioGeneration).not.toHaveProperty("AudioGenerationRequestBuilder");
    expect(completion).not.toHaveProperty("CompletionRequestBuilder");
    expect(completion).toHaveProperty("createCompletion");
    expect(completion).toHaveProperty("createParsedCompletion");
    expect(completion).toHaveProperty("createCompletionStream");
    expect(completion).toHaveProperty("Message");
    expect(embeddings).toHaveProperty("embedText");
    expect(evals).toHaveProperty("runEvalSuite");
    expect(evals).toHaveProperty("EvalOutcome");
    expect(evals).toHaveProperty("defaultEvalTraceSelector");
    expect(evals).toHaveProperty("projectEvalOutcome");
    expect(evals).toHaveProperty("resolveEvalTraceRef");
    expect(evals).toHaveProperty("answerRelevancy");
    expect(evals).toHaveProperty("gEval");
    expect(evals).toHaveProperty("promptAlignment");
    expect(evals).toHaveProperty("jsonCorrectness");
    expect(evals).toHaveProperty("summarization");
    expect(evals).toHaveProperty("hallucination");
    expect(evals).toHaveProperty("faithfulness");
    expect(evals).toHaveProperty("turnRelevancy");
    expect(evals).toHaveProperty("knowledgeRetention");
    expect(extractor).toHaveProperty("ExtractorBuilder");
    expect(guardrails).toHaveProperty("defineGuardrailPolicy");
    expect(guardrails).toHaveProperty("defineInputGuardrail");
    expect(guardrails).toHaveProperty("defineOutputGuardrail");
    expect(guardrails).not.toHaveProperty("defineToolGuardrail");
    expect(guardrails).not.toHaveProperty("defineToolResultGuardrail");
    expect(guardrails).toHaveProperty("guardrails");
    expect(guardrails.guardrails).toMatchObject({
      blockText: expect.any(Function),
      redactText: expect.any(Function),
    });
    expect(imageGeneration).toHaveProperty("generateImage");
    expect(imageGeneration).not.toHaveProperty("imageGenerationRequest");
    expect(imageGeneration).not.toHaveProperty("ImageGenerationRequestBuilder");
    expect(loaders).toHaveProperty("FileLoader");
    expect(mcp).toHaveProperty("connectMcp");
    expect(modelListing).toHaveProperty("ModelListingError");
    expect(observability).toHaveProperty("createObserver");
    expect(pipeline).toHaveProperty("PipelineBuilder");
    expect(skills).toHaveProperty("loadSkills");
    expect(streaming).toHaveProperty("toReadableStream");
    expect(tool).toHaveProperty("createTool");
    expect(transcription).toHaveProperty("transcribe");
    expect(transcription).not.toHaveProperty("transcriptionRequest");
    expect(transcription).not.toHaveProperty("TranscriptionRequestBuilder");
    expect(vectorStore).toHaveProperty("InMemoryVectorStore");
  });

  it("exposes pipeline agent stages without prompt aliases", () => {
    expect(pipeline.PipelineBuilder.prototype).toHaveProperty("agent");
    expect(pipeline.PipelineBuilder.prototype).not.toHaveProperty("prompt");
  });

  it("exposes direct model operations from the root entrypoint", () => {
    expect("createCompletion" in publicCore).toBe(true);
    expect("createParsedCompletion" in publicCore).toBe(true);
    expect("createCompletionStream" in publicCore).toBe(true);
    expect("generateImage" in publicCore).toBe(true);
    expect("generateSpeech" in publicCore).toBe(true);
    expect("transcribe" in publicCore).toBe(true);
  });

  it("exposes memory compaction helpers from root and memory entrypoints", () => {
    expect(publicCore).toHaveProperty("createSummaryMemoryCompactor");
    expect(publicCore).toHaveProperty("isMemoryCompactionSummary");
    expect(publicCore).toHaveProperty("MemoryCompactionError");
    expect(publicCore).toHaveProperty("MemoryCompactionConflictError");
    expect(memory).toHaveProperty("createSummaryMemoryCompactor");
    expect(memory).toHaveProperty("isMemoryCompactionSummary");
  });

  it("exposes guardrail helpers from the root entrypoint", () => {
    expect("defineGuardrailPolicy" in publicCore).toBe(true);
    expect("defineInputGuardrail" in publicCore).toBe(true);
    expect("defineOutputGuardrail" in publicCore).toBe(true);
    expect("defineToolGuardrail" in publicCore).toBe(false);
    expect("defineToolResultGuardrail" in publicCore).toBe(false);
    expect(publicCore).toHaveProperty("guardrails");
    expect(publicCore.guardrails).toMatchObject({
      blockText: expect.any(Function),
      redactText: expect.any(Function),
    });
  });

  it("exposes ToolContent from the root entrypoint", () => {
    expect(publicCore).toHaveProperty("ToolContent");
    const toolResult: RootToolContentType = RootToolContent.toolResult("abc", "hello", "call_123");

    expect(RootMessage.tool(toolResult)).toMatchObject({
      role: "tool",
      content: [
        {
          type: "tool_result",
          id: "abc",
          callId: "call_123",
          content: [{ type: "text", text: "hello" }],
        },
      ],
    });
  });
});
