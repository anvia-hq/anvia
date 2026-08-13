import type { AgentRunOptions } from "../../agent/run-types";
import type { AgentHook } from "../../hooks";

const internalAgentRunOptions = Symbol("internalAgentRunOptions");

export type InternalAgentRunOptions = {
  hook?: AgentHook | undefined;
  runId?: string | undefined;
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
