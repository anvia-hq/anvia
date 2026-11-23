import { AgentStructuredOutputError } from "../../agent/errors";
import type { AgentOutcome, AgentStreamEvent } from "../../agent/run-types";
import {
  type CompletionFinishReason,
  type CompletionModel,
  type CompletionRequest,
  type CompletionResponse,
  type CompletionSource,
  type ContextUsage,
  getAssistantGenerationMetadata,
  type JsonObject,
  type Message as MessageType,
  type ProviderToolCall,
  textFromAssistantContent,
  type Usage,
} from "../../completion/index";
import type { GuardrailDecisionRecord } from "../../guardrails";
import type { AgentRunEndArgs } from "../../observability/types";
import { completionProviderOutputErrorUsage } from "../../retry";
import {
  STRUCTURED_OUTPUT_RETRY_PROMPT,
  STRUCTURED_OUTPUT_TRUNCATED_RETRY_PROMPT,
  structuredOutputRepairPreview,
} from "./structured-output";

export type StructuredOutputRetryRequest = Readonly<{
  request: CompletionRequest;
  previousResponse: "omitted" | "preview";
  includedOutputLength: number;
}>;

export async function settleFailureCleanup(
  operations: Array<() => void | Promise<void> | undefined>,
): Promise<void> {
  for (const operation of operations) {
    try {
      await operation();
    } catch {
      continue;
    }
  }
}

export function generatedAssistantMessage(
  model: Pick<CompletionModel, "provider" | "modelId">,
  response: CompletionResponse,
): MessageType {
  const generation: JsonObject = {
    provider: model.provider,
    modelId: model.modelId,
    usage: { ...response.usage },
  };

  if (response.finishReason !== undefined) generation.finishReason = response.finishReason;

  if (response.providerFinishReason !== undefined) {
    generation.providerFinishReason = response.providerFinishReason;
  }

  if (response.contextUsage !== undefined) generation.contextUsage = response.contextUsage;

  if (response.sources !== undefined) generation.sources = response.sources;

  if (response.providerToolCalls !== undefined) {
    generation.providerToolCalls = response.providerToolCalls;
  }

  const metadata: JsonObject = { anvia: { generation } };
  let message: MessageType = {
    role: "assistant",
    content: response.choice,
    metadata,
  };

  if (response.messageId !== undefined) message = { ...message, id: response.messageId };

  return message;
}

export function responseStreamEvents(
  turn: number,
  response: CompletionResponse,
  includeProviderArtifacts = true,
): AgentStreamEvent[] {
  const events: AgentStreamEvent[] = [];
  for (const item of response.choice) {
    if (item.type === "text") {
      if (item.text.length > 0) {
        events.push({ type: "text_delta", turn, delta: item.text });
      }

      continue;
    }

    if (item.type === "reasoning") {
      if (item.details === undefined) {
        if (item.text.length > 0) {
          events.push(reasoningDeltaEvent(turn, item.text, { id: item.id }));
        }

        continue;
      }

      for (const content of item.details) {
        const delta =
          content.type === "encrypted" || content.type === "redacted" ? content.data : content.text;
        events.push(
          reasoningDeltaEvent(turn, delta, {
            id: item.id,
            contentType: content.type,
            signature: content.type === "text" ? content.signature : undefined,
          }),
        );
      }
      continue;
    }

    if (item.type === "tool-call") {
      events.push({ type: "tool_call", turn, toolCall: item });
    }
  }

  if (includeProviderArtifacts) {
    for (const source of response.sources ?? []) {
      events.push({ type: "source", turn, source });
    }
    for (const toolCall of response.providerToolCalls ?? []) {
      events.push({ type: "provider_tool_call", turn, toolCall });
    }
  }

  return events;
}

export function generationArtifacts(messages: MessageType[]): {
  sources?: CompletionSource[];
  providerToolCalls?: ProviderToolCall[];
  finishReason?: CompletionFinishReason;
  providerFinishReason?: string;
  contextUsage?: ContextUsage;
} {
  const sources = new Map<string, CompletionSource>();
  const providerToolCalls = new Map<string, ProviderToolCall>();
  let finishReason: CompletionFinishReason | undefined;
  let providerFinishReason: string | undefined;
  let contextUsage: ContextUsage | undefined;
  for (const message of messages) {
    const metadata = getAssistantGenerationMetadata(message);

    if (metadata !== undefined) {
      finishReason = metadata.finishReason;
      providerFinishReason = metadata.providerFinishReason;
      contextUsage = metadata.contextUsage;
    }

    for (const source of metadata?.sources ?? []) {
      const key = `${source.url}\u0000${source.startIndex ?? ""}\u0000${source.endIndex ?? ""}`;
      sources.set(key, source);
    }
    for (const toolCall of metadata?.providerToolCalls ?? []) {
      providerToolCalls.set(toolCall.id, toolCall);
    }
  }
  const artifacts: {
    sources?: CompletionSource[];
    providerToolCalls?: ProviderToolCall[];
    finishReason?: CompletionFinishReason;
    providerFinishReason?: string;
    contextUsage?: ContextUsage;
  } = {};

  if (sources.size > 0) artifacts.sources = [...sources.values()];

  if (providerToolCalls.size > 0) {
    artifacts.providerToolCalls = [...providerToolCalls.values()];
  }

  if (finishReason !== undefined) artifacts.finishReason = finishReason;

  if (providerFinishReason !== undefined) {
    artifacts.providerFinishReason = providerFinishReason;
  }

  if (contextUsage !== undefined) artifacts.contextUsage = contextUsage;

  return artifacts;
}

type ReasoningDeltaEvent = Extract<AgentStreamEvent, { type: "reasoning_delta" }>;

function reasoningDeltaEvent(
  turn: number,
  delta: string,
  details: {
    id?: ReasoningDeltaEvent["id"] | undefined;
    contentType?: ReasoningDeltaEvent["contentType"] | undefined;
    signature?: ReasoningDeltaEvent["signature"] | undefined;
  } = {},
): ReasoningDeltaEvent {
  const event: ReasoningDeltaEvent = {
    type: "reasoning_delta",
    turn,
    delta,
  };

  if (details.id !== undefined) {
    event.id = details.id;
  }

  if (details.contentType !== undefined) {
    event.contentType = details.contentType;
  }

  if (details.signature !== undefined) {
    event.signature = details.signature;
  }

  return event;
}

export function structuredOutputRetryRequest(
  request: CompletionRequest,
  response: CompletionResponse,
  error: unknown,
): StructuredOutputRetryRequest {
  const truncated = error instanceof AgentStructuredOutputError && error.phase === "truncated";
  const correction: MessageType = {
    role: "user",
    content: truncated ? STRUCTURED_OUTPUT_TRUNCATED_RETRY_PROMPT : STRUCTURED_OUTPUT_RETRY_PROMPT,
  };

  if (truncated) {
    return {
      request: {
        ...request,
        chatHistory: [...request.chatHistory, correction],
      },
      previousResponse: "omitted",
      includedOutputLength: 0,
    };
  }

  const preview = structuredOutputRepairPreview(textFromAssistantContent(response.choice));

  if (preview.includedOutputLength === 0) {
    return {
      request: {
        ...request,
        chatHistory: [...request.chatHistory, correction],
      },
      previousResponse: "omitted",
      includedOutputLength: 0,
    };
  }

  const invalidResponse: MessageType = {
    role: "assistant",
    content: [{ type: "text", text: preview.text }],
  };
  return {
    request: {
      ...request,
      chatHistory: [...request.chatHistory, invalidResponse, correction],
    },
    previousResponse: "preview",
    includedOutputLength: preview.includedOutputLength,
  };
}

export function structuredOutputRetryEventAttributes(
  error: unknown,
  retryRequest: StructuredOutputRetryRequest,
): JsonObject {
  const attributes: JsonObject = {
    previousResponse: retryRequest.previousResponse,
    includedOutputLength: retryRequest.includedOutputLength,
  };

  if (!(error instanceof AgentStructuredOutputError)) return attributes;

  Object.assign(attributes, {
    failurePhase: error.phase,
    outputLength: error.outputLength,
    normalizedLength: error.normalizedLength,
    attemptUsage: usageEventValue(error.attemptUsage),
    cumulativeUsage: usageEventValue(error.usage),
  });

  if (error.finishReason !== undefined) attributes.finishReason = error.finishReason;

  if (error.providerFinishReason !== undefined) {
    attributes.providerFinishReason = error.providerFinishReason;
  }

  return attributes;
}

export function providerOutputRetryEventAttributes(
  error: unknown,
  cumulativeUsage: Usage,
  attemptUsage?: Usage | undefined,
): JsonObject | undefined {
  const resolvedAttemptUsage = attemptUsage ?? completionProviderOutputErrorUsage(error);

  if (resolvedAttemptUsage === undefined) return undefined;

  return {
    attemptUsage: usageEventValue(resolvedAttemptUsage),
    cumulativeUsage: usageEventValue(cumulativeUsage),
  };
}

export function usageEventValue(usage: Usage): JsonObject {
  const value: JsonObject = {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    cachedInputTokens: usage.cachedInputTokens,
    cacheCreationInputTokens: usage.cacheCreationInputTokens,
  };

  if (usage.details !== undefined) value.details = { ...usage.details };

  return value;
}

export function guardrailDecisionAttributes(decision: GuardrailDecisionRecord): JsonObject {
  const attributes: JsonObject = {
    policyId: decision.policyId,
    guardrailId: decision.guardrailId,
    boundary: decision.boundary,
    mode: decision.mode,
    action: decision.action,
    applied: decision.applied,
    latencyMs: decision.latencyMs,
  };

  if (decision.reason !== undefined) {
    attributes.reason = decision.reason;
  }

  if (decision.message !== undefined) {
    attributes.message = decision.message;
  }

  return attributes;
}

export function blockedOutcomeDetails(
  decisions: readonly GuardrailDecisionRecord[],
  fallbackReason: string,
): { reason: string; message?: string | undefined } {
  for (let index = decisions.length - 1; index >= 0; index -= 1) {
    const decision = decisions[index];

    if (decision?.applied !== true || decision.action !== "block") continue;

    return decision.message === undefined
      ? { reason: decision.reason ?? fallbackReason }
      : { reason: decision.reason ?? fallbackReason, message: decision.message };
  }
  return { reason: fallbackReason };
}

export function observerRunEnd<Output>(outcome: AgentOutcome<Output>): AgentRunEndArgs {
  const common = {
    runId: outcome.runId,
    text: outcome.text,
    usage: outcome.usage,
    messages: outcome.messages,
    sources: outcome.sources,
    providerToolCalls: outcome.providerToolCalls,
    resumedFrom: outcome.resumedFrom,
  };
  switch (outcome.type) {
    case "response":
      return { ...common, status: "completed", output: outcome.output };
    case "blocked":
      return { ...common, status: "blocked", stage: outcome.stage };
    case "interaction":
      return { ...common, status: "suspended", interaction: outcome.interaction };
  }
}
