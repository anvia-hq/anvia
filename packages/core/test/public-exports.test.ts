import { describe, expect, expectTypeOf, it } from "vitest";
import type {
  DynamicContextOptions,
  DynamicToolOptions,
  AgentSession as PublicAgentSessionType,
  Agent as PublicAgentType,
} from "../src/agent";
import * as publicAgent from "../src/agent";
import * as audioGeneration from "../src/audio-generation";
import * as completion from "../src/completion";
import * as embeddings from "../src/embeddings";
import * as evals from "../src/evals";
import * as extractor from "../src/extractor";
import * as hooks from "../src/hooks";
import * as imageGeneration from "../src/image-generation";
import type { ToolContent as RootToolContentType } from "../src/index";
import * as publicCore from "../src/index";
import { Message as RootMessage, ToolContent as RootToolContent } from "../src/index";
import * as internalAgent from "../src/internal/agent";
import * as loaders from "../src/loaders";
import * as mcp from "../src/mcp";
import * as modelListing from "../src/model-listing";
import * as observability from "../src/observability";
import * as pipeline from "../src/pipeline";
import * as request from "../src/request";
import * as skills from "../src/skills";
import * as streaming from "../src/streaming";
import * as tool from "../src/tool";
import * as transcription from "../src/transcription";
import * as ui from "../src/ui";
import * as vectorStore from "../src/vector-store";

describe("public exports", () => {
  it("exposes public agent type exports", () => {
    expectTypeOf<PublicAgentType>().not.toBeNever();
    expectTypeOf<PublicAgentSessionType>().not.toBeNever();
    expectTypeOf<DynamicContextOptions>().not.toBeNever();
    expectTypeOf<DynamicToolOptions>().not.toBeNever();
  });

  it("exposes AgentBuilder from the public entrypoints", () => {
    expect("AgentBuilder" in publicCore).toBe(true);
    expect("AgentBuilder" in publicAgent).toBe(true);
  });

  it("exposes middleware helpers from public entrypoints", () => {
    expect("createMiddleware" in publicCore).toBe(true);
    expect("createToolMiddleware" in publicCore).toBe(true);
    expect("createMiddleware" in publicAgent).toBe(false);
    expect("createToolMiddleware" in publicAgent).toBe(false);
    expect("createMiddleware" in tool).toBe(true);
    expect("createToolMiddleware" in tool).toBe(true);
  });

  it("keeps runtime Agent and AgentSession out of public entrypoints", () => {
    expect("Agent" in publicCore).toBe(false);
    expect("Agent" in publicAgent).toBe(false);
    expect("AgentSession" in publicAgent).toBe(false);
  });

  it("exposes runtime Agent through the internal agent entrypoint", () => {
    expect("Agent" in internalAgent).toBe(true);
    expect("AgentSession" in internalAgent).toBe(true);
  });

  it("keeps prompt runtime helpers out of the public agent entrypoint", () => {
    expect("createHook" in publicAgent).toBe(false);
    expect("skipTool" in publicAgent).toBe(false);
    expect("PromptCancelledError" in publicAgent).toBe(false);
    expect("MaxTurnsError" in publicAgent).toBe(false);
    expect("ToolApprovalRequiredError" in publicAgent).toBe(false);
  });

  it("exposes prompt hooks from the hooks entrypoint", () => {
    expect("createHook" in publicCore).toBe(true);
    expect("createHook" in hooks).toBe(true);
    expect("skipTool" in hooks).toBe(true);
  });

  it("exposes prompt request contracts from the request entrypoint", () => {
    expect("PromptCancelledError" in request).toBe(true);
    expect("MaxTurnsError" in request).toBe(true);
    expect("ToolApprovalRequiredError" in request).toBe(true);
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
    expect(audioGeneration).toHaveProperty("AudioGenerationRequestBuilder");
    expect(hooks).toHaveProperty("createHook");
    expect(request).toHaveProperty("PromptRequest");
    expect(audioGeneration).toHaveProperty("audioGenerationRequest");
    expect(completion).toHaveProperty("CompletionRequestBuilder");
    expect(completion).toHaveProperty("createCompletion");
    expect(completion).toHaveProperty("createParsedCompletion");
    expect(completion).toHaveProperty("createCompletionStream");
    expect(completion).toHaveProperty("Message");
    expect(embeddings).toHaveProperty("embedText");
    expect(evals).toHaveProperty("runEvalSuite");
    expect(evals).toHaveProperty("EvalOutcome");
    expect(extractor).toHaveProperty("ExtractorBuilder");
    expect(imageGeneration).toHaveProperty("ImageGenerationRequestBuilder");
    expect(loaders).toHaveProperty("FileLoader");
    expect(mcp).toHaveProperty("connectMcp");
    expect(modelListing).toHaveProperty("ModelListingError");
    expect(observability).toHaveProperty("createObserver");
    expect(pipeline).toHaveProperty("PipelineBuilder");
    expect(skills).toHaveProperty("loadSkills");
    expect(streaming).toHaveProperty("toReadableStream");
    expect(tool).toHaveProperty("createTool");
    expect(transcription).toHaveProperty("TranscriptionRequestBuilder");
    expect(vectorStore).toHaveProperty("InMemoryVectorStore");
  });

  it("exposes createCompletion from the root entrypoint", () => {
    expect("createCompletion" in publicCore).toBe(true);
    expect("createParsedCompletion" in publicCore).toBe(true);
    expect("createCompletionStream" in publicCore).toBe(true);
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
