import { describe, expect, it } from "vitest";
import * as publicAgent from "../src/agent";
import * as audioGeneration from "../src/audio-generation";
import * as completion from "../src/completion";
import * as embeddings from "../src/embeddings";
import * as evals from "../src/evals";
import * as extractor from "../src/extractor";
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
import * as skills from "../src/skills";
import * as streaming from "../src/streaming";
import * as tool from "../src/tool";
import * as transcription from "../src/transcription";
import * as vectorStore from "../src/vector-store";

describe("public exports", () => {
  it("exposes AgentBuilder from the public entrypoints", () => {
    expect("AgentBuilder" in publicCore).toBe(true);
    expect("AgentBuilder" in publicAgent).toBe(true);
  });

  it("exposes middleware helpers from public entrypoints", () => {
    expect("createMiddleware" in publicCore).toBe(true);
    expect("createToolMiddleware" in publicCore).toBe(true);
    expect("createMiddleware" in publicAgent).toBe(true);
    expect("createToolMiddleware" in publicAgent).toBe(true);
    expect("createMiddleware" in tool).toBe(true);
    expect("createToolMiddleware" in tool).toBe(true);
  });

  it("keeps runtime Agent out of public entrypoints", () => {
    expect("Agent" in publicCore).toBe(false);
    expect("Agent" in publicAgent).toBe(false);
  });

  it("exposes runtime Agent through the internal agent entrypoint", () => {
    expect("Agent" in internalAgent).toBe(true);
  });

  it("keeps public subpath runtime exports available", () => {
    expect(audioGeneration).toHaveProperty("AudioGenerationRequestBuilder");
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
