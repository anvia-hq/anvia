import type {
  AgentGenerationEndArgs,
  AgentGenerationStartArgs,
  AgentToolStartArgs,
} from "@anvia/core/observability";

export function modelParameters(
  request: AgentGenerationStartArgs["request"],
): Record<string, string | number> {
  const params: Record<string, string | number> = {};
  if (request.temperature !== undefined) params.temperature = request.temperature;
  if (request.maxTokens !== undefined) params.maxTokens = request.maxTokens;
  if (request.toolChoice !== undefined) {
    params.toolChoice =
      typeof request.toolChoice === "string" ? request.toolChoice : request.toolChoice.name;
  }
  return params;
}

export function usageDetails(
  usage: AgentGenerationEndArgs["response"]["usage"],
): Record<string, number> {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    cachedInputTokens: usage.cachedInputTokens,
    cacheCreationInputTokens: usage.cacheCreationInputTokens,
  };
}

export function usageDetailsFromRecord(usage: Record<string, unknown>): Record<string, number> {
  return {
    inputTokens: numberValue(usage.inputTokens) ?? 0,
    outputTokens: numberValue(usage.outputTokens) ?? 0,
    totalTokens:
      numberValue(usage.totalTokens) ??
      (numberValue(usage.inputTokens) ?? 0) + (numberValue(usage.outputTokens) ?? 0),
  };
}

export function childMetadata(
  args: AgentToolStartArgs,
  agentId: string,
  agentName: string | undefined,
  childTurn: number,
): Record<string, unknown> {
  return {
    source: "agent_tool_event",
    childAgentId: agentId,
    childAgentName: agentName,
    childTurn,
    parentToolName: args.toolName,
    parentInternalCallId: args.internalCallId,
    parentToolCallId: args.toolCallId,
  };
}

export function generationKey(agentId: string, turn: number): string {
  return `${agentId}:${turn}`;
}

export function agentLabel(agentId: string, agentName: string | undefined): string {
  return (agentName ?? agentId).replaceAll(/\s+/g, "_");
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

export function emptyToUndefined(value: string | undefined): string | undefined {
  return value === undefined || value.length === 0 ? undefined : value;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
