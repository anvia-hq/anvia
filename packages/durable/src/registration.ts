import { AGENT_RUN_EXECUTION_VERSION, getResolvedAgentOptions } from "@anvia/core/internal/agent";
import { isStreamingCompletionModel } from "@anvia/core/completion";
import { compactionPolicySchema, modelRetrySchema } from "./schema.js";
import { nonblank } from "./json.js";
import type { DurableAgentRegistration } from "./types.js";

export function registrations(
  values: readonly DurableAgentRegistration[],
): Map<string, DurableAgentRegistration> {
  if (AGENT_RUN_EXECUTION_VERSION !== 3) throw new Error("Unsupported core execution protocol.");
  const result = new Map<string, DurableAgentRegistration>();
  for (const registration of values) {
    nonblank(registration.version, "Agent version");
    const { agent } = registration;
    if (registration.stream !== undefined && typeof registration.stream !== "boolean")
      throw new TypeError("Durable stream option must be a boolean.");
    if (
      registration.stream === true &&
      (!agent.model.capabilities.streaming || !isStreamingCompletionModel(agent.model))
    )
      throw new TypeError("Durable streaming requires a streaming-capable model.");
    const options = getResolvedAgentOptions(agent);
    if (result.has(agent.id)) throw new TypeError(`Duplicate durable agent: ${agent.id}`);
    // These callbacks can perform effects or change requests during reconstruction.
    // Add them only with their own persistence boundaries, never silently replay them.
    if (
      agent.memory !== undefined ||
      agent.lifecycle !== undefined ||
      agent.middlewares.length > 0 ||
      agent.guardrails.length > 0 ||
      agent.context.length > 0 ||
      agent.mcpServers.length > 0 ||
      (options.providerTools?.length ?? 0) > 0 ||
      (options.toolIndexes?.length ?? 0) > 0
    ) {
      throw new TypeError(
        "Durable agents currently support static local tools and instructions; memory, lifecycle, middleware, guardrails, context, MCP, provider tools, and tool indexes require additional checkpoint support.",
      );
    }
    for (const [name, policy] of Object.entries(registration.toolRecovery ?? {})) {
      if (agent.getTool(name) === undefined) throw new TypeError(`Unknown recovery tool: ${name}`);
      if (policy !== "safe" && policy !== "idempotent" && policy !== "manual")
        throw new TypeError(`Invalid recovery policy for ${name}`);
    }
    let compaction;
    if (registration.compaction !== undefined) {
      const { compactor, tokenCounter, ...policy } = registration.compaction;
      if (
        typeof compactor !== "function" ||
        (tokenCounter !== undefined && typeof tokenCounter !== "function")
      )
        throw new TypeError(
          "Durable compaction requires a compactor and an optional token counter.",
        );
      const parsed = compactionPolicySchema.parse(policy);
      compaction = {
        trigger: parsed.trigger,
        ...(parsed.retention === undefined ? {} : { retention: parsed.retention }),
        compactor,
        ...(tokenCounter === undefined ? {} : { tokenCounter }),
      };
    }
    result.set(agent.id, {
      agent,
      version: registration.version,
      ...(registration.stream === undefined ? {} : { stream: registration.stream }),
      toolRecovery: { ...registration.toolRecovery },
      ...(compaction === undefined ? {} : { compaction }),
      ...(registration.modelRetry === undefined
        ? {}
        : { modelRetry: modelRetrySchema.parse(registration.modelRetry) }),
    });
  }
  return result;
}
