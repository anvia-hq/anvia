import type { Message } from "../../completion";
import type { AgentHook } from "../../hooks";
import type { MemoryCompactionInfo } from "../../memory";

const internalAgentRunOptions = Symbol("internalAgentRunOptions");

export type InternalAgentRunOptions = {
  hook?: AgentHook | undefined;
  onFailure?: ((failure: { error: unknown; messages: readonly Message[] }) => void) | undefined;
  onMemoryCompaction?: ((compaction: MemoryCompactionInfo) => void | Promise<void>) | undefined;
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
