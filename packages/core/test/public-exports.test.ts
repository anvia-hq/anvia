import { describe, expect, expectTypeOf, it } from "vitest";
import type {
  AgentContextInput,
  AgentOptions,
  AgentToolInput,
  AgentToolOptions,
  CreateVectorContextOptions,
  AgentErrorStreamEvent as PublicAgentErrorStreamEvent,
  AgentRunOptions as PublicAgentRunOptions,
  AgentStreamEvent as PublicAgentStreamEvent,
  AgentToolCallDeltaEvent as PublicAgentToolCallDeltaEvent,
  Agent as PublicAgentType,
  RetryContext as PublicRetryContext,
  RetryOptions as PublicRetryOptions,
  VectorContext,
} from "../src/agent";
import * as publicAgent from "../src/agent";
import * as completion from "../src/completion";
import * as embeddings from "../src/embeddings";
// @ts-expect-error EvalSuiteTypeBuilder was removed from the public eval API.
import type { EvalSuiteTypeBuilder as RemovedEvalSuiteTypeBuilder } from "../src/evals";
import * as evals from "../src/evals";
// @ts-expect-error ExtractorBuilder was removed from the public extractor API.
import type { ExtractorBuilder as RemovedExtractorBuilder } from "../src/extractor";
import * as extractor from "../src/extractor";
import * as guardrails from "../src/guardrails";
import * as imageGeneration from "../src/image-generation";
import type {
  AgentErrorStreamEvent as RootAgentErrorStreamEvent,
  AgentRunOptions as RootAgentRunOptions,
  AgentStreamEvent as RootAgentStreamEvent,
  AgentToolCallDeltaEvent as RootAgentToolCallDeltaEvent,
  AgentToolOptions as RootAgentToolOptions,
  RetryContext as RootRetryContext,
  RetryOptions as RootRetryOptions,
  ToolContent as RootToolContentType,
} from "../src/index";
import * as publicCore from "../src/index";
import { Message as RootMessage, ToolContent as RootToolContent, Usage } from "../src/index";
// @ts-expect-error ToolApprovalRequest is private to the agent runtime.
import type { ToolApprovalRequest as InternalToolApprovalRequest } from "../src/internal/agent";
import * as internalAgent from "../src/internal/agent";
import * as loaders from "../src/loaders";
import * as mcp from "../src/mcp";
import * as memory from "../src/memory";
import * as modelListing from "../src/model-listing";
import * as observability from "../src/observability";
// @ts-expect-error PipelineBuilder was removed from the public pipeline API.
import type { PipelineBuilder as RemovedPipelineBuilder } from "../src/pipeline";
import * as pipeline from "../src/pipeline";
import * as skills from "../src/skills";
import * as speechGeneration from "../src/speech-generation";
import * as streaming from "../src/streaming";
import * as tool from "../src/tool";
import * as transcription from "../src/transcription";
import * as vectorStore from "../src/vector-store";

// @ts-expect-error AgentSession was removed in favor of Agent.generate/stream session options.
type RemovedPublicAgentSession = import("../src/agent").AgentSession;
// @ts-expect-error AgentSession was removed from the root API.
type RemovedRootAgentSession = import("../src/index").AgentSession;
// @ts-expect-error MemoryContext was replaced by MemoryScope.
type RemovedMemoryContext = import("../src/memory").MemoryContext;
// @ts-expect-error MemoryAppendInput was replaced by MemoryAppendOptions.
type RemovedMemoryAppendInput = import("../src/memory").MemoryAppendInput;
// @ts-expect-error MemoryErrorInput was replaced by MemoryErrorOptions.
type RemovedMemoryErrorInput = import("../src/memory").MemoryErrorInput;
// @ts-expect-error MemoryCompactionStore was replaced by MemoryCompactionCapability.
type RemovedMemoryCompactionStore = import("../src/memory").MemoryCompactionStore;
// @ts-expect-error MemoryCompactionCommitInput was replaced by prefix replacement options.
type RemovedMemoryCompactionCommitInput = import("../src/memory").MemoryCompactionCommitInput;
// @ts-expect-error SummaryMemoryCompactorOptions was replaced by object-only creator options.
type RemovedSummaryMemoryCompactorOptions = import("../src/memory").SummaryMemoryCompactorOptions;
// @ts-expect-error MemoryRegistration was removed from the public memory API.
type RemovedMemoryRegistration = import("../src/memory").MemoryRegistration;
// @ts-expect-error ResolvedMemoryOptions was removed from the public memory API.
type RemovedResolvedMemoryOptions = import("../src/memory").ResolvedMemoryOptions;
// @ts-expect-error SessionOptions was replaced by MemoryScope on Agent inputs.
type RemovedSessionOptions = import("../src/memory").SessionOptions;
// @ts-expect-error McpConnection was removed in favor of McpClient lifecycle ownership.
type RemovedMcpConnection = import("../src/mcp").McpConnection;
// @ts-expect-error McpSseOptions was removed with the legacy SSE transport.
type RemovedMcpSseOptions = import("../src/mcp").McpSseOptions;
// @ts-expect-error connectMcp was removed in favor of McpClient.connect.
type RemovedConnectMcp = typeof import("../src/mcp").connectMcp;
// @ts-expect-error The MCP factory namespace was removed in favor of constructors.
type RemovedMcpFactory = typeof import("../src/mcp").mcp;

describe("public exports", () => {
  it("exposes public agent type exports", () => {
    expectTypeOf<AgentOptions>().not.toBeNever();
    expectTypeOf<PublicAgentType>().not.toBeNever();
    expectTypeOf<RemovedPublicAgentSession>().toBeAny();
    expectTypeOf<AgentContextInput>().not.toBeNever();
    expectTypeOf<VectorContext>().not.toBeNever();
    expectTypeOf<CreateVectorContextOptions>().not.toBeNever();
    expectTypeOf<AgentToolInput>().not.toBeNever();
    expectTypeOf<AgentToolOptions>().not.toBeNever();
    expectTypeOf<RemovedRootAgentSession>().toBeAny();
    expectTypeOf<RootAgentToolOptions>().toEqualTypeOf<AgentToolOptions>();
    expectTypeOf<Parameters<PublicAgentType["generate"]>["length"]>().toEqualTypeOf<1>();
    expectTypeOf<Parameters<PublicAgentType["stream"]>["length"]>().toEqualTypeOf<1>();
    const agent = null as unknown as PublicAgentType;
    if (Date.now() === Number.NEGATIVE_INFINITY) {
      // @ts-expect-error Agent.generate no longer accepts a positional prompt.
      agent.generate("hello");
      // @ts-expect-error Agent.stream no longer accepts a positional prompt.
      agent.stream("hello");
    }
  });

  it("does not expose the removed AgentBuilder", () => {
    expect("AgentBuilder" in publicCore).toBe(false);
    expect("AgentBuilder" in publicAgent).toBe(false);
  });

  it("exposes vector context helpers from the public entrypoints", () => {
    expect("createVectorContext" in publicCore).toBe(true);
    expect("createVectorContext" in publicAgent).toBe(true);
    expect("isVectorContext" in publicCore).toBe(true);
    expect("isVectorContext" in publicAgent).toBe(true);
  });

  it("exposes middleware helpers from public entrypoints", () => {
    expect("createMiddleware" in publicCore).toBe(true);
    expect("createToolMiddleware" in publicCore).toBe(false);
    expect("createMiddleware" in publicAgent).toBe(false);
    expect("createToolMiddleware" in publicAgent).toBe(false);
    expect("createMiddleware" in tool).toBe(true);
    expect("createToolMiddleware" in tool).toBe(false);
  });

  it("exposes runtime Agent without the removed AgentSession surface", () => {
    expect("Agent" in publicCore).toBe(true);
    expect("Agent" in publicAgent).toBe(true);
    expect("AgentSession" in publicAgent).toBe(false);
    expect(publicAgent.Agent.prototype).not.toHaveProperty("session");
  });

  it("exposes only the internal Agent integration contract", () => {
    expect("Agent" in internalAgent).toBe(true);
    expect("createResolvedAgent" in internalAgent).toBe(true);
    expect("getResolvedAgentOptions" in internalAgent).toBe(true);
    expect("getAgentToolState" in internalAgent).toBe(true);
    expect("getAgentApprovalRequestDetails" in internalAgent).toBe(true);
    expect("withInternalAgentRunOptions" in internalAgent).toBe(true);
    expect("AgentSession" in internalAgent).toBe(false);
    expect("DEFAULT_MAX_TURNS" in internalAgent).toBe(false);
    expect("cancelAgentApproval" in internalAgent).toBe(false);
    expectTypeOf<InternalToolApprovalRequest>().not.toBeNever();
  });

  it("exposes agent run errors from the public agent entrypoint", () => {
    expect("createHook" in publicAgent).toBe(false);
    expect("skipTool" in publicAgent).toBe(false);
    expect("AgentRunCancelledError" in publicAgent).toBe(true);
    expect("AgentRunBlockedError" in publicAgent).toBe(true);
    expect("MaxTurnsError" in publicAgent).toBe(true);
    expect("ToolApprovalRequiredError" in publicAgent).toBe(false);
  });

  it("keeps controlling hooks internal", () => {
    expect("createHook" in publicCore).toBe(false);
    expect("createHook" in internalAgent).toBe(true);
    expect("skipTool" in internalAgent).toBe(false);
    expect("cancelRun" in internalAgent).toBe(false);
    expect("requestToolApproval" in internalAgent).toBe(false);
    expect("runControl" in internalAgent).toBe(false);
    expect("toolCallControl" in internalAgent).toBe(false);
  });

  it("exposes agent run contracts from root and agent entrypoints", () => {
    expectTypeOf<RootRetryContext>().toEqualTypeOf<PublicRetryContext>();
    expectTypeOf<RootRetryOptions>().toEqualTypeOf<PublicRetryOptions>();
    expectTypeOf<RootAgentErrorStreamEvent>().toEqualTypeOf<PublicAgentErrorStreamEvent>();
    expectTypeOf<RootAgentRunOptions>().toEqualTypeOf<PublicAgentRunOptions>();
    expectTypeOf<RootAgentToolCallDeltaEvent>().toEqualTypeOf<PublicAgentToolCallDeltaEvent>();
    expectTypeOf<RootAgentStreamEvent>().toEqualTypeOf<PublicAgentStreamEvent>();
    expectTypeOf<
      Extract<PublicAgentStreamEvent, { type: "tool_call_delta" }>
    >().toEqualTypeOf<PublicAgentToolCallDeltaEvent>();
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

  it("does not expose client/UI protocol concerns", () => {
    expect("createCompletionUIStream" in publicCore).toBe(false);
    expect("createAgentUIStream" in publicCore).toBe(false);
    expect("completionStreamToUIStream" in publicCore).toBe(false);
    expect("agentStreamToUIStream" in publicCore).toBe(false);
    expect("UIMessage" in publicCore).toBe(false);
    expect("uiMessagesToMessages" in publicCore).toBe(false);
  });

  it("keeps public subpath runtime exports available", () => {
    expectTypeOf<RemovedEvalSuiteTypeBuilder>().toBeAny();
    expect(speechGeneration).toHaveProperty("generateSpeech");
    expect(completion).not.toHaveProperty("CompletionRequestBuilder");
    expect(completion).toHaveProperty("generateCompletion");
    expect(completion).toHaveProperty("streamCompletion");
    expect(completion).not.toHaveProperty("createCompletion");
    expect(completion).not.toHaveProperty("createParsedCompletion");
    expect(completion).not.toHaveProperty("createCompletionStream");
    expect(completion).toHaveProperty("Message");
    expect(embeddings).toHaveProperty("embedText");
    expect(embeddings).toHaveProperty("embedDocuments");
    expect(embeddings).not.toHaveProperty("embedHybridDocuments");
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
    expect(extractor).toHaveProperty("extract");
    expect(extractor).not.toHaveProperty("ExtractorBuilder");
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
    expect(mcp).toHaveProperty("McpClient");
    expect(mcp).toHaveProperty("McpClientGroup");
    expect(mcp).toHaveProperty("isMcpTool");
    expect(mcp).not.toHaveProperty("connectMcp");
    expect(mcp).not.toHaveProperty("mcp");
    expect(modelListing).toHaveProperty("ModelListingError");
    expect(observability).toHaveProperty("createObserver");
    expect(pipeline).toHaveProperty("Pipeline");
    expect(pipeline).not.toHaveProperty("PipelineBuilder");
    expect(skills).toHaveProperty("loadSkills");
    expect(streaming).toHaveProperty("toReadableStream");
    expect(tool).toHaveProperty("createTool");
    expect(transcription).toHaveProperty("transcribe");
    expect(transcription).not.toHaveProperty("transcriptionRequest");
    expect(transcription).not.toHaveProperty("TranscriptionRequestBuilder");
    expectTypeOf<RemovedMcpConnection>().toBeAny();
    expectTypeOf<RemovedMcpSseOptions>().toBeAny();
    expectTypeOf<RemovedConnectMcp>().toBeAny();
    expectTypeOf<RemovedMcpFactory>().toBeAny();

    if (Date.now() === Number.NEGATIVE_INFINITY) {
      new mcp.McpClient({
        name: "http",
        transport: {
          type: "streamableHttp",
          url: "https://example.com/mcp",
          // @ts-expect-error Built-in HTTP intentionally forbids custom fetch.
          fetch: globalThis.fetch,
        },
      });
      const server = null as unknown as mcp.McpServer;
      // @ts-expect-error McpServer is a registration snapshot and does not own lifecycle.
      server.close();
    }
    expect(vectorStore).toHaveProperty("InMemoryVectorStore");
    expect(vectorStore).toHaveProperty("retrieveDocuments");
    expect(vectorStore).toHaveProperty("createVectorSearchTool");
    expect(vectorStore).not.toHaveProperty("VectorSearchIndex");
    expect(publicAgent).not.toHaveProperty("createContextIndex");
    expect(publicAgent).not.toHaveProperty("isContextIndex");
  });

  it("rejects removed positional embedding signatures at compile time", () => {
    const removedSignatures = () => {
      const model = {
        async embedTexts(texts: string[]) {
          return texts.map((document) => ({ document, vector: [1] }));
        },
      };
      // @ts-expect-error Embedding helpers accept one object argument in RC2.
      void embeddings.embedText(model, "text");
      // @ts-expect-error Document embedding accepts one object argument in RC2.
      void embeddings.embedDocuments(model, ["text"], { content: (text: string) => text });
    };
    expect(removedSignatures).toBeTypeOf("function");
  });

  it("exposes direct pipelines without builder, build, or prompt aliases", () => {
    expectTypeOf<RemovedPipelineBuilder>().toBeAny();
    expect(publicCore).not.toHaveProperty("Pipeline");
    expect(pipeline.Pipeline.prototype).toHaveProperty("agent");
    expect(pipeline.Pipeline.prototype).not.toHaveProperty("build");
    expect(pipeline.Pipeline.prototype).not.toHaveProperty("prompt");
  });

  it("exposes stateless extraction without builder or class APIs", () => {
    expectTypeOf<RemovedExtractorBuilder>().toBeAny();
    expect(publicCore).not.toHaveProperty("Extractor");
    expect(extractor).toHaveProperty("extract");
    expect(extractor).not.toHaveProperty("Extractor");
    expect(extractor).not.toHaveProperty("ExtractorBuilder");
  });

  it("exposes direct model operations from the root entrypoint", () => {
    expect("generateCompletion" in publicCore).toBe(true);
    expect("streamCompletion" in publicCore).toBe(true);
    expect("createCompletion" in publicCore).toBe(false);
    expect("createParsedCompletion" in publicCore).toBe(false);
    expect("createCompletionStream" in publicCore).toBe(false);
    expect("generateImage" in publicCore).toBe(true);
    expect("generateSpeech" in publicCore).toBe(true);
    expect("transcribe" in publicCore).toBe(true);
  });

  it("exposes canonical memory helpers from root and memory entrypoints", () => {
    expect(publicCore).toHaveProperty("createMemoryScopeKey");
    expect(publicCore).toHaveProperty("createSummaryMemoryCompactor");
    expect(publicCore).toHaveProperty("isMemoryCompactionMessage");
    expect(publicCore).toHaveProperty("MemoryCompactionError");
    expect(publicCore).toHaveProperty("MemoryCompactionConflictError");
    expect(memory).toHaveProperty("createMemoryScopeKey");
    expect(memory).toHaveProperty("createSummaryMemoryCompactor");
    expect(memory).toHaveProperty("isMemoryCompactionMessage");
    expectTypeOf<RemovedMemoryContext>().toBeAny();
    expectTypeOf<RemovedMemoryAppendInput>().toBeAny();
    expectTypeOf<RemovedMemoryErrorInput>().toBeAny();
    expectTypeOf<RemovedMemoryCompactionStore>().toBeAny();
    expectTypeOf<RemovedMemoryCompactionCommitInput>().toBeAny();
    expectTypeOf<RemovedSummaryMemoryCompactorOptions>().toBeAny();
    expectTypeOf<RemovedMemoryRegistration>().toBeAny();
    expectTypeOf<RemovedResolvedMemoryOptions>().toBeAny();
    expectTypeOf<RemovedSessionOptions>().toBeAny();
    expectTypeOf<
      Parameters<typeof memory.createSummaryMemoryCompactor>["length"]
    >().toEqualTypeOf<1>();
    expect(
      memory.createMemoryScopeKey({
        scope: {
          sessionId: "thread-1",
          userId: "user-1",
          metadata: { tenant: { id: "tenant-1" } },
        },
        metadataKeys: ["tenant.id"],
      }),
    ).toBe(JSON.stringify(["thread-1", "user-1", "tenant-1"]));

    const capability = null as unknown as import("../src/memory").MemoryCompactionCapability;
    const model = null as unknown as import("../src/completion").CompletionModel;
    if (Date.now() === Number.NEGATIVE_INFINITY) {
      // @ts-expect-error Old compaction snapshot method was removed.
      capability.load({ sessionId: "session_1" });
      // @ts-expect-error Old compaction commit method was removed.
      capability.commit({});
      // @ts-expect-error Summary compactor construction is object-only.
      memory.createSummaryMemoryCompactor(model);
    }
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
