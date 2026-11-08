import { getResolvedAgentOptions } from "@anvia/core/internal/agent";
import type {
  DurableAgentCompatibility,
  DurableAgentRegistration,
  DurableFrozenAgentOption,
  DurableUnavailableRunSetting,
} from "./types.js";

/**
 * Per-run `AgentRunSettings` / memory-scoped `AgentInput` fields that durable does not expose.
 * Durable replaces `session` with its own session history. The per-run `lifecycle`, `guardrails`,
 * and `middlewares` are not exposed; their agent-level forms are admitted only with a registration
 * marker. `retries`, `maxTurns`, and `controls` are runtime-managed.
 */
const UNAVAILABLE_RUN_SETTINGS: readonly DurableUnavailableRunSetting[] = Object.freeze([
  "retries",
  "maxTurns",
  "controls",
  "lifecycle",
  "guardrails",
  "middlewares",
  "toolConcurrency",
  "session",
]);

/**
 * Detached, immutable description of every registration, in registration order. Callers may log
 * or retain it; mutating it cannot change the runtime's registrations.
 */
export function compatibilityReport(
  agents: ReadonlyMap<string, DurableAgentRegistration>,
): readonly DurableAgentCompatibility[] {
  return Object.freeze([...agents.values()].map(describeRegistration));
}

function describeRegistration(registration: DurableAgentRegistration): DurableAgentCompatibility {
  const options = getResolvedAgentOptions(registration.agent);
  // The resolved model-turn budget is captured into each run record at submission, so it is
  // always frozen for a registration; the remaining entries only apply when the agent sets them.
  const frozen: DurableFrozenAgentOption[] = ["maxTurns"];
  if (options.controls !== undefined) frozen.push("controls");
  if (options.toolChoice !== undefined) frozen.push("toolChoice");
  if (options.temperature !== undefined) frozen.push("temperature");
  if (options.maxTokens !== undefined) frozen.push("maxTokens");
  if (options.providerOptions !== undefined) frozen.push("providerOptions");
  if (options.outputSchema !== undefined) frozen.push("outputSchema");

  return Object.freeze({
    agentId: registration.agent.id,
    version: registration.version,
    tools: Object.freeze((options.tools ?? []).map((tool) => tool.name)),
    streaming: registration.stream === true,
    toolConcurrency: registration.toolConcurrency ?? 1,
    compaction: registration.compaction !== undefined,
    modelRetry:
      registration.modelRetry === undefined
        ? undefined
        : Object.freeze({ ...registration.modelRetry }),
    frozen: Object.freeze(frozen),
    unavailable: UNAVAILABLE_RUN_SETTINGS,
  });
}
