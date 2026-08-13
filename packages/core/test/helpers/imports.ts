export * from "../../src/agent";
export * from "../../src/audio-generation";
export * from "../../src/completion";
export * from "../../src/embeddings";
export * from "../../src/evals";
export * from "../../src/extractor";
export * from "../../src/guardrails";
export * from "../../src/hooks";
export * from "../../src/image-generation";
export * from "../../src/internal/agent";
export * from "../../src/mcp";
export * from "../../src/memory";
export * from "../../src/model-listing";
export * from "../../src/observability";
export * from "../../src/pipeline";
export * from "../../src/skills";
export * from "../../src/streaming";
export * from "../../src/tool";
export * from "../../src/transcription";
export * from "../../src/ui";
export * from "../../src/vector-store";
export * from "./test-agent-builder";

import type { AgentResponse, AgentResult } from "../../src/agent";

export function assertCompleted(result: AgentResult): asserts result is AgentResponse {
  if (result.status !== "completed") {
    throw new Error(`Expected completed agent result, received ${result.status}`);
  }
}
