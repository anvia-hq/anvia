import type { ProviderTool } from "../completion";
import type { ToolIndex } from "../tool/dynamic-tools";
import type { AnyTool } from "../tool/tool";

export type AgentToolState = {
  configuredTools: readonly AnyTool[];
  staticTools: readonly AnyTool[];
  providerTools: readonly ProviderTool[];
  toolIndexes: readonly ToolIndex[];
};

type StoredAgentToolState = {
  publicState: AgentToolState;
  toolsByName: Map<string, AnyTool>;
};

const agentToolStates = new WeakMap<object, StoredAgentToolState>();

export function registerAgentToolState(
  agent: object,
  publicState: AgentToolState,
  toolsByName: Map<string, AnyTool>,
): void {
  agentToolStates.set(agent, { publicState, toolsByName });
}

export function getAgentToolState(agent: object): AgentToolState {
  return getStoredAgentToolState(agent).publicState;
}

export function getRegisteredAgentTool(agent: object, toolName: string): AnyTool | undefined {
  return getStoredAgentToolState(agent).toolsByName.get(toolName);
}

function getStoredAgentToolState(agent: object): StoredAgentToolState {
  const state = agentToolStates.get(agent);
  if (state === undefined) {
    throw new TypeError("Agent tool state is unavailable.");
  }
  return state;
}
