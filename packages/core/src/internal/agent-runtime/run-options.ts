import type { AgentLifecycle } from "../../agent/lifecycle";
import type { Message } from "../../completion";
import type { AgentHook } from "../../hooks";
import type { MemoryCompactionInfo } from "../../memory";
import type { AgentRunExecution } from "./execution";

const internalAgentRunOptions = Symbol("internalAgentRunOptions");

export type InternalAgentRunOptions = {
  /** Persistence boundaries for model and tool execution. */
  execution?: AgentRunExecution | undefined;
  hook?: AgentHook | undefined;
  onFailure?: ((failure: { error: unknown; messages: readonly Message[] }) => void) | undefined;
  onMemoryCompaction?: ((compaction: MemoryCompactionInfo) => void | Promise<void>) | undefined;
  runId?: string | undefined;
  beforeFinish?: (() => void | Promise<void>) | undefined;
  onSteeringApplied?: ((id: string) => void) | undefined;
  /**
   * Replaces the agent's own lifecycle hooks and any per-run lifecycle for this run. Durable uses
   * it to gate observational hooks so a replayed step does not fire them again.
   */
  lifecycle?: AgentLifecycle<never, never> | undefined;
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
