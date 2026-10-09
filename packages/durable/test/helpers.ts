import { Agent } from "@anvia/core/agent";
export { Agent };
import {
  Usage,
  type CompletionModel,
  type CompletionRequest,
  type CompletionResponse,
  type StreamingCompletionModel,
} from "@anvia/core/completion";
import type { AnyTool } from "@anvia/core/tool";

export const capabilities: CompletionModel["capabilities"] = {
  streaming: false,
  tools: true,
  toolChoice: true,
  imageInput: false,
  documentInput: false,
  outputSchema: true,
  reasoning: false,
};

export function response(choice: CompletionResponse["choice"]): CompletionResponse {
  return {
    choice,
    usage: { ...Usage.empty(), inputTokens: 2, outputTokens: 1, totalTokens: 3 },
    rawResponse: {},
  };
}

export function makeAgent(
  completion: (request: CompletionRequest, signal?: AbortSignal) => Promise<CompletionResponse>,
  tools: AnyTool[] = [],
  modelCapabilities: CompletionModel["capabilities"] = capabilities,
): Agent {
  return new Agent({
    id: "researcher",
    tools,
    model: {
      provider: "test",
      modelId: "test",
      capabilities: modelCapabilities,
      completion: (request, options) => completion(request, options?.abortSignal),
    },
  });
}

export function toolResponse(): CompletionResponse {
  return response([{ type: "tool-call", toolCallId: "call-1", toolName: "lookup", input: {} }]);
}

export function makeStreamingAgent(
  streamCompletion: StreamingCompletionModel["streamCompletion"],
  tools: AnyTool[] = [],
): Agent {
  return new Agent({
    id: "researcher",
    tools,
    model: {
      provider: "test",
      modelId: "test",
      capabilities: { ...capabilities, streaming: true },
      completion: async () => done(),
      streamCompletion,
    },
  });
}

export const done = () => response([{ type: "text", text: "done" }]);

export const lookup = (call: AnyTool["call"]): AnyTool => ({
  name: "lookup",
  definition: () => ({
    name: "lookup",
    description: "Look up data",
    parameters: { type: "object", properties: {} },
  }),
  call,
});

export function hasToolResult(request: CompletionRequest): boolean {
  return request.chatHistory.some((message) => message.role === "tool");
}
