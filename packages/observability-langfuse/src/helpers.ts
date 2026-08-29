import type {
  AgentGenerationEndArgs,
  AgentGenerationStartArgs,
  AgentRunStartArgs,
  AgentToolStartArgs,
} from "@anvia/core/observability";

type ObservedMessage = AgentRunStartArgs["prompt"];

export function modelInputMessage(message: ObservedMessage): Omit<ObservedMessage, "metadata"> {
  const { metadata: _metadata, ...result } = message;
  return result;
}

export function modelInputMessages(
  messages: readonly ObservedMessage[],
): Array<Omit<ObservedMessage, "metadata">> {
  return messages.map(modelInputMessage);
}

export function modelParameters(
  request: AgentGenerationStartArgs["request"],
): Record<string, string | number> {
  const params: Record<string, string | number> = {};
  if (request.temperature !== undefined) params.temperature = request.temperature;
  if (request.maxTokens !== undefined) params.maxTokens = request.maxTokens;
  if (request.controls?.reasoningEffort !== undefined) {
    params.reasoningEffort = request.controls.reasoningEffort;
  }
  if (request.toolChoice !== undefined) {
    params.toolChoice =
      typeof request.toolChoice === "string" ? request.toolChoice : request.toolChoice.name;
  }
  return params;
}

export function usageDetails(
  usage: AgentGenerationEndArgs["response"]["usage"],
): Record<string, number> {
  if (usage.details !== undefined && Object.keys(usage.details).length > 0) {
    return { ...usage.details };
  }
  return {
    input: usage.inputTokens,
    output: usage.outputTokens,
    total: usage.totalTokens,
  };
}

export function usageDetailsFromRecord(usage: Record<string, unknown>): Record<string, number> {
  if (isRecord(usage.details)) {
    const details = Object.fromEntries(
      Object.entries(usage.details).filter(
        (entry): entry is [string, number] =>
          typeof entry[1] === "number" && Number.isFinite(entry[1]) && entry[1] >= 0,
      ),
    );
    if (Object.keys(details).length > 0) {
      return details;
    }
  }
  return {
    input: numberValue(usage.inputTokens) ?? 0,
    output: numberValue(usage.outputTokens) ?? 0,
    total:
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

/**
 * Resolve an option value: prefer the explicit option, fall back to the
 * env var, and treat empty strings as missing. Empty env vars are common
 * when a process inherits a process manager that injects blank values.
 */
export function resolveOption(
  option: string | undefined,
  envVar: string | undefined,
): string | undefined {
  return emptyToUndefined(option) ?? emptyToUndefined(envVar);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
