import type { CompletionModel } from "../completion";
import { Agent } from "./agent";
import { markResolvedAgentOptions } from "./resolve-options";
import { getAgentToolState } from "./tool-state";
import type { ResolvedAgentOptions } from "./types";

export function createResolvedAgent<
  Output = string,
  M extends CompletionModel = CompletionModel,
  ContextDocument = unknown,
>(options: ResolvedAgentOptions<Output, M, ContextDocument>): Agent<Output, M, ContextDocument> {
  return new Agent(markResolvedAgentOptions(options));
}

export function getResolvedAgentOptions<Output, M extends CompletionModel, ContextDocument>(
  agent: Agent<Output, M, ContextDocument>,
): ResolvedAgentOptions<Output, M, ContextDocument> {
  const toolState = getAgentToolState(agent);
  return {
    id: agent.id,
    name: agent.name,
    description: agent.description,
    model: agent.model,
    instructions: agent.instructions,
    context: [...agent.context],
    temperature: agent.temperature,
    maxTokens: agent.maxTokens,
    providerOptions: agent.providerOptions,
    controls: agent.controls,
    retries: agent.retries,
    tools: [...toolState.configuredTools],
    mcpServers: [...agent.mcpServers],
    providerTools: [...toolState.providerTools],
    toolIndexes: [...toolState.toolIndexes],
    toolChoice: agent.toolChoice,
    defaultMaxTurns: agent.defaultMaxTurns,
    lifecycle: agent.lifecycle,
    outputSchema: agent.outputSchema,
    observability: agent.observability,
    guardrails: [...agent.guardrails],
    middlewares: [...agent.middlewares],
    memory: agent.memory,
  };
}
