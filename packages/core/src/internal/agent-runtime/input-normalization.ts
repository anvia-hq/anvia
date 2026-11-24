import {
  type AgentInteractionResponse,
  assertAgentInteractionResponse,
  parseAgentContinuation,
  parseAgentInteractionResponse,
} from "../../agent/interactions";
import type { AgentInput, AgentSteerInput } from "../../agent/run-types";
import { getAgentToolState } from "../../agent/tool-state";
import {
  type Message as MessageType,
  parseMessage,
  parseMessages,
  type ToolInteractionResponsePart,
  textFromAssistantContent,
} from "../../completion/index";
import { isMcpTool } from "../../mcp";
import type { MemoryScope } from "../../memory/types";
import type { AgentTraceOptions } from "../../observability/types";
import { isSkillTool } from "../../tool/skill-tool-marker";
import { type AgentContinuationState, parseContinuationState } from "./continuation-state";
import { normalizeMemoryScope } from "./memory-scope";

export type NormalizedAgentInput = {
  prompt: MessageType;
  history: MessageType[];
  scope?: MemoryScope | undefined;
  continuationState?: AgentContinuationState | undefined;
  interactionResponse?: AgentInteractionResponse | undefined;
  sourceRunId?: string | undefined;
  interactionId?: string | undefined;
};

export function normalizeAgentInput(agentId: string, input: AgentInput): NormalizedAgentInput {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new TypeError("Agent runs require one options object with prompt or messages.");
  }

  const hasContinuation = "continuation" in input && input.continuation !== undefined;
  const hasPrompt = "prompt" in input && input.prompt !== undefined;
  const hasMessages = "messages" in input && input.messages !== undefined;

  if (Number(hasContinuation) + Number(hasPrompt) + Number(hasMessages) !== 1) {
    throw new TypeError("Agent runs require exactly one of prompt, messages, or continuation.");
  }

  if (hasContinuation) {
    if (!("response" in input) || input.response === undefined) {
      throw new TypeError("Agent continuation runs require an interaction response.");
    }

    if ("session" in input && input.session !== undefined) {
      throw new TypeError("Agent continuations carry their memory scope and cannot use session.");
    }

    const continuation = parseAgentContinuation(input.continuation);

    if (continuation.agentId !== agentId) {
      throw new TypeError(
        `Agent continuation belongs to "${continuation.agentId}", not "${agentId}".`,
      );
    }

    const response = parseAgentInteractionResponse(input.response);
    assertAgentInteractionResponse(continuation.interaction, response);
    const state = parseContinuationState(continuation.state, continuation.interaction);
    let responsePart: ToolInteractionResponsePart;

    if (response.type === "tool-approval") {
      responsePart = {
        type: "tool-approval-response",
        interactionId: continuation.interaction.id,
        toolCallId: continuation.interaction.toolCallId,
        toolName: continuation.interaction.toolName,
        approved: response.approved,
      };

      if (response.reason !== undefined) {
        responsePart = { ...responsePart, reason: response.reason };
      }
    } else {
      responsePart = {
        type: "tool-question-response",
        interactionId: continuation.interaction.id,
        toolCallId: continuation.interaction.toolCallId,
        toolName: continuation.interaction.toolName,
        answers: response.answers,
      };
    }

    if (continuation.interaction.callId !== undefined) {
      responsePart = { ...responsePart, callId: continuation.interaction.callId };
    }

    const normalized: NormalizedAgentInput = {
      prompt: parseMessage({ role: "tool", content: [responsePart] }),
      history: [...state.history, ...state.messages],
      continuationState: state,
      interactionResponse: response,
      sourceRunId: continuation.sourceRunId,
      interactionId: continuation.interaction.id,
    };

    if (state.memoryScope !== undefined) {
      normalized.scope = normalizeMemoryScope(state.memoryScope);
    }

    return normalized;
  }

  if (hasPrompt) {
    const prompt = input.prompt;

    if (
      typeof prompt !== "string" &&
      (typeof prompt !== "object" || prompt === null || prompt.role !== "user")
    ) {
      throw new TypeError("Agent prompt must be text or a user message.");
    }

    const parsedPrompt = parseMessage(
      typeof prompt === "string" ? { role: "user", content: prompt } : prompt,
    );

    if (parsedPrompt.role !== "user") {
      throw new TypeError("Agent prompt must be text or a user message.");
    }

    const normalized: NormalizedAgentInput = {
      prompt: parsedPrompt,
      history: [],
    };

    if (input.session !== undefined) {
      normalized.scope = normalizeMemoryScope(input.session);
    }

    return normalized;
  }

  if (input.session !== undefined) {
    throw new TypeError("Agent messages cannot be combined with a persisted session.");
  }

  const messages = input.messages;

  if (!Array.isArray(messages) || messages.length === 0) {
    throw new TypeError("Agent input transcript must contain at least one message.");
  }

  const parsedMessages = parseMessages(messages);
  const activePrompt = parsedMessages.at(-1);

  if (activePrompt === undefined) {
    throw new TypeError("Agent input transcript must contain at least one message.");
  }

  if (activePrompt.role !== "user") {
    throw new TypeError("Agent input transcript must end with a user message.");
  }

  return {
    prompt: activePrompt,
    history: parsedMessages.slice(0, -1),
  };
}

export function normalizeSteeringInput(input: AgentSteerInput): MessageType[] {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new TypeError("Agent steering requires one options object with prompt or messages.");
  }

  const hasPrompt = "prompt" in input && input.prompt !== undefined;
  const hasMessages = "messages" in input && input.messages !== undefined;

  if (hasPrompt === hasMessages) {
    throw new TypeError("Agent steering requires exactly one of prompt or messages.");
  }

  if (hasPrompt) {
    const prompt = input.prompt;

    if (
      typeof prompt !== "string" &&
      (typeof prompt !== "object" || prompt === null || prompt.role !== "user")
    ) {
      throw new TypeError("Agent steering prompt must be text or a user message.");
    }

    const parsedPrompt = parseMessage(
      typeof prompt === "string" ? { role: "user", content: prompt } : prompt,
    );

    if (parsedPrompt.role !== "user") {
      throw new TypeError("Agent steering prompt must be text or a user message.");
    }

    return [parsedPrompt];
  }

  const messages = input.messages;

  if (!Array.isArray(messages) || messages.length === 0) {
    throw new TypeError("Agent steering messages must contain at least one user message.");
  }

  const parsedMessages = parseMessages(messages);

  if (parsedMessages.some((message) => message.role !== "user")) {
    throw new TypeError("Agent steering messages must all be user messages.");
  }

  return parsedMessages;
}

export function normalizeRequestedRunId(runId: string | undefined): string | undefined {
  if (runId === undefined) {
    return undefined;
  }

  if (typeof runId !== "string" || runId.trim().length === 0) {
    throw new TypeError("runId must be a non-empty string.");
  }

  return runId;
}

export function abortReason(reason: unknown): string {
  if (typeof reason === "string" && reason.trim().length > 0) return reason;

  if (reason instanceof Error && reason.message.trim().length > 0) return reason.message;

  return "External abort signal.";
}

export function withMemoryScopeTrace(
  trace: AgentTraceOptions | undefined,
  scope: MemoryScope | undefined,
): AgentTraceOptions | undefined {
  if (scope === undefined) return trace;

  const sessionId = trace?.sessionId ?? scope.sessionId;
  const userId = trace?.userId ?? scope.userId;

  if (sessionId === trace?.sessionId && userId === trace?.userId) return trace;

  return { ...trace, sessionId, userId };
}

export function providerMessages(messages: readonly MessageType[]): MessageType[] {
  const result: MessageType[] = [];
  for (const message of messages) {
    if (message.role !== "tool") {
      result.push(message);
      continue;
    }

    const results = message.content.filter((part) => part.type === "tool-result");

    if (results.length > 0) {
      result.push({ ...message, content: results });
    }
  }
  return result;
}

export function textFromMessage(message: MessageType): string {
  if (message.role === "system") {
    return message.content;
  }

  if (typeof message.content === "string") {
    return message.content;
  }

  return message.content
    .flatMap((content) => {
      if (content.type === "text") {
        return [content.text];
      }

      if (content.type === "file" && content.data.type === "text") {
        return [content.data.text];
      }

      return [];
    })
    .join("\n");
}

export function latestAssistantText(messages: readonly MessageType[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];

    if (message?.role === "assistant") {
      return typeof message.content === "string"
        ? message.content
        : textFromAssistantContent(message.content);
    }
  }
  return "";
}

export function mcpToolNames(agent: object): string[] {
  return getAgentToolState(agent)
    .staticTools.filter((tool) => isMcpTool(tool))
    .map((tool) => tool.name);
}

export function skillToolNames(agent: object): string[] {
  const state = getAgentToolState(agent);
  const names = new Set<string>();
  for (const tool of state.staticTools) {
    if (isSkillTool(tool)) names.add(tool.name);
  }
  for (const index of state.toolIndexes) {
    for (const tool of index.tools) {
      if (isSkillTool(tool)) names.add(tool.name);
    }
  }
  return [...names];
}

export function agentSkillInstructions(agent: object): string | undefined {
  return getAgentToolState(agent).skillInstructions;
}
