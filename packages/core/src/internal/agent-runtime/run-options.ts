import type { AgentLifecycle } from "../../agent/lifecycle";
import type { Message } from "../../completion";
import type { GuardrailPolicy } from "../../guardrails";
import type { AgentHook } from "../../hooks";
import type { MemoryCompactionInfo, MemoryScope, MemoryStore } from "../../memory";
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
  /**
   * Replaces the agent's guardrail policies for this run. Durable uses it to record each check's
   * outcome before core applies it, so a replayed check is not run again.
   */
  guardrails?: readonly GuardrailPolicy[] | undefined;
  /**
   * Replaces the agent's memory store and session scope for this run. Durable uses it so every
   * read and write goes through its recording store, and the run needs no session in its input.
   */
  memory?: { store: MemoryStore; scope: MemoryScope } | undefined;
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
