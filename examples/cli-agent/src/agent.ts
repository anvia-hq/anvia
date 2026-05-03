import { AgentBuilder } from "@anvia/core/agent";
import { OpenAIClient } from "@anvia/openai";
import { getModelName, getTavilyApiKey, OPENROUTER_BASE_URL } from "./config.js";
import { toAnviaHistory } from "./memory.js";
import { createLocalWorkspaceTools } from "./tools/local.js";
import { createTavilySearchTool } from "./tools/tavily.js";
import type { ChatMessage } from "./types.js";

const SYSTEM_PROMPT = [
  "You are a concise, helpful assistant.",
  "You have local workspace tools for writing files, updating files, and executing shell commands. These tools operate inside the .tmp directory only. Use them when the user asks you to create, modify, inspect, or run files.",
  "You have a web_search tool. Use it when the user asks for current, recent, external, or web-verifiable information. Cite source URLs from search results when you use it.",
].join("\n");

const MAX_TURNS = 50;

type StreamAssistantOptions = {
  apiKey: string;
  prompt: string;
  history: ChatMessage[];
  onDelta: (delta: string) => void;
  onReasoningDelta?: (delta: string) => void;
  onToolCall?: (event: { id: string; callId?: string; name: string; args: unknown }) => void;
  onToolResult?: (event: { id: string; callId?: string; name: string; result: string }) => void;
};

export async function streamAssistantResponse({
  apiKey,
  prompt,
  history,
  onDelta,
  onReasoningDelta,
  onToolCall,
  onToolResult,
}: StreamAssistantOptions) {
  const client = new OpenAIClient({
    apiKey,
    baseUrl: OPENROUTER_BASE_URL,
  });
  const tavilyApiKey = getTavilyApiKey();
  const model = client.completionModel(getModelName());
  const builder = new AgentBuilder("assistant", model)
    .instructions(SYSTEM_PROMPT)
    .tool(createTavilySearchTool(tavilyApiKey))
    .tools(createLocalWorkspaceTools());

  const agent = builder.build();

  for await (const event of agent
    .prompt(prompt)
    .withHistory(toAnviaHistory(history))
    .maxTurns(MAX_TURNS)
    .stream()) {
    if (event.type === "text_delta") {
      onDelta(event.delta);
    }

    if (event.type === "reasoning_delta") {
      onReasoningDelta?.(event.delta);
    }

    if (event.type === "tool_call") {
      onToolCall?.({
        id: event.toolCall.id,
        name: event.toolCall.function.name,
        args: event.toolCall.function.arguments,
        ...(event.toolCall.callId === undefined ? {} : { callId: event.toolCall.callId }),
      });
    }

    if (event.type === "tool_result") {
      onToolResult?.({
        id: event.internalCallId,
        name: event.toolName,
        result: event.result,
        ...(event.toolCallId === undefined ? {} : { callId: event.toolCallId }),
      });
    }

    if (event.type === "error") {
      throw event.error;
    }
  }
}
