import {
  type Agent,
  createResolvedAgent,
  getResolvedAgentOptions,
  type ResolvedAgentOptions,
} from "@anvia/core/internal/agent";

export function cloneAgent(agent: Agent, overrides: Partial<ResolvedAgentOptions> = {}): Agent {
  return createResolvedAgent({
    ...getResolvedAgentOptions(agent),
    ...overrides,
  });
}
