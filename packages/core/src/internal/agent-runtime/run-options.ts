import type { AgentRunOptions } from "../../agent/run-types";
import type { AgentHook } from "../../hooks";

const internalAgentRunOptions = Symbol("internalAgentRunOptions");
const internalAgentHooks = new WeakMap<object, AgentHook>();

export type InternalAgentRunOptions = {
  hook?: AgentHook | undefined;
};

type AgentRunOptionsWithInternal = AgentRunOptions & {
  [internalAgentRunOptions]?: InternalAgentRunOptions;
};

export function withInternalAgentRunOptions<T extends AgentRunOptions>(
  options: T,
  internal: InternalAgentRunOptions,
): T {
  return {
    ...options,
    [internalAgentRunOptions]: internal,
  };
}

export function getInternalAgentRunOptions(
  options: AgentRunOptions,
): InternalAgentRunOptions | undefined {
  return (options as AgentRunOptionsWithInternal)[internalAgentRunOptions];
}

export function setInternalAgentHook(agent: object, hook: AgentHook): void {
  internalAgentHooks.set(agent, hook);
}

export function getInternalAgentHook(agent: object): AgentHook | undefined {
  return internalAgentHooks.get(agent);
}
