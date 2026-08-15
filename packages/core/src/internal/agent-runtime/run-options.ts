import type { AgentHook } from "../../hooks";

const internalAgentRunOptions = Symbol("internalAgentRunOptions");

export type InternalAgentRunOptions = {
  hook?: AgentHook | undefined;
  runId?: string | undefined;
};

type AgentRunOptionsWithInternal = {
  [internalAgentRunOptions]?: InternalAgentRunOptions;
};

export function withInternalAgentRunOptions<T extends object>(
  options: T,
  internal: InternalAgentRunOptions,
): T {
  return {
    ...options,
    [internalAgentRunOptions]: internal,
  };
}

export function getInternalAgentRunOptions(options: object): InternalAgentRunOptions | undefined {
  return (options as AgentRunOptionsWithInternal)[internalAgentRunOptions];
}
