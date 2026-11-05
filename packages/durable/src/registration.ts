import { AGENT_RUN_EXECUTION_VERSION, getResolvedAgentOptions } from "@anvia/core/internal/agent";
import { isVectorContext } from "@anvia/core/agent";
import { isStreamingCompletionModel } from "@anvia/core/completion";
import type { GuardrailPolicy } from "@anvia/core/guardrails";
import { compactionPolicySchema, modelRetrySchema } from "./schema.js";
import { nonblank } from "./json.js";
import type { DurableAgentRegistration } from "./types.js";

export function registrations(
  values: readonly DurableAgentRegistration[],
): Map<string, DurableAgentRegistration> {
  if (AGENT_RUN_EXECUTION_VERSION !== 4) throw new Error("Unsupported core execution protocol.");
  const result = new Map<string, DurableAgentRegistration>();
  for (const registration of values) {
    nonblank(registration.version, "Agent version");
    const { agent } = registration;
    if (registration.lifecycle !== undefined && registration.lifecycle.mode !== "observe")
      throw new TypeError(
        `Durable agent "${agent.id}" has an unknown lifecycle mode. Only { mode: "observe" } is supported.`,
      );
    if (registration.stream !== undefined && typeof registration.stream !== "boolean")
      throw new TypeError("Durable stream option must be a boolean.");
    if (
      registration.stream === true &&
      (!agent.model.capabilities.streaming || !isStreamingCompletionModel(agent.model))
    )
      throw new TypeError("Durable streaming requires a streaming-capable model.");
    const options = getResolvedAgentOptions(agent);
    if (result.has(agent.id)) throw new TypeError(`Duplicate durable agent: ${agent.id}`);
    // Agent-level retries would restart a model request without a persisted attempt, so the
    // runtime executes with retries disabled. Reject the setting instead of silently disabling it.
    if (retriesEnabled(options.retries))
      throw new TypeError(
        `Durable agent "${agent.id}" defines retries, which the durable runtime cannot honour: every run executes with retries disabled so a replay never repeats an unrecorded attempt. Configure modelRetry on the registration instead, or remove retries from the agent.`,
      );
    // These callbacks can perform effects or change requests during reconstruction.
    // Add them only with their own persistence boundaries, never silently replay them.
    if (
      registration.middlewares !== undefined &&
      (registration.middlewares as { mode?: unknown }).mode !== "pure"
    )
      throw new TypeError(
        `Durable agent "${agent.id}" has an unknown middlewares mode. Only { mode: "pure" } is supported.`,
      );
    if (
      registration.guardrails !== undefined &&
      (registration.guardrails as { mode?: unknown }).mode !== "record"
    )
      throw new TypeError(
        `Durable agent "${agent.id}" has an unknown guardrails mode. Only { mode: "record" } is supported.`,
      );
    if (registration.guardrails !== undefined) assertUniqueGuardrailIds(agent);
    const unsupported = unsupportedFeatures(options, registration);
    if (unsupported.length > 0) {
      const hints = [
        unsupported.includes("middleware")
          ? `middleware needs { middlewares: { mode: "pure" } }`
          : "",
        unsupported.includes("guardrails")
          ? `guardrails need { guardrails: { mode: "record" } }`
          : "",
      ].filter((hint) => hint !== "");
      throw new TypeError(
        `Durable agent "${agent.id}" (version ${JSON.stringify(registration.version)}) uses features that require additional checkpoint support: ${unsupported.join(", ")}. Durable agents support static local tools, static context documents, and instructions only.${hints.length > 0 ? ` To admit them, set the registration marker: ${hints.join("; ")}.` : ""}`,
      );
    }
    for (const [name, policy] of Object.entries(registration.toolRecovery ?? {})) {
      if (agent.getTool(name) === undefined) throw new TypeError(`Unknown recovery tool: ${name}`);
      if (policy !== "safe" && policy !== "idempotent" && policy !== "manual")
        throw new TypeError(`Invalid recovery policy for ${name}`);
    }

    let compaction: DurableAgentRegistration["compaction"];
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
        compactor,
      };

      if (parsed.retention !== undefined) {
        compaction.retention = parsed.retention;
      }

      if (tokenCounter !== undefined) {
        compaction.tokenCounter = tokenCounter;
      }
    }

    const normalized: DurableAgentRegistration = {
      agent,
      version: registration.version,
    };

    if (registration.stream !== undefined) {
      normalized.stream = registration.stream;
    }

    if (registration.lifecycle !== undefined) {
      normalized.lifecycle = { mode: "observe" };
    }

    if (registration.middlewares !== undefined) {
      normalized.middlewares = { mode: "pure" };
    }

    if (registration.guardrails !== undefined) {
      normalized.guardrails = { mode: "record" };
    }

    normalized.toolRecovery = { ...registration.toolRecovery };

    if (compaction !== undefined) {
      normalized.compaction = compaction;
    }

    if (registration.modelRetry !== undefined) {
      normalized.modelRetry = modelRetrySchema.parse(registration.modelRetry);
    }

    result.set(agent.id, normalized);
  }
  return result;
}

type ResolvedOptions = ReturnType<typeof getResolvedAgentOptions>;

/** `false`, `0`, and a one-attempt policy all mean the runtime would not retry anyway. */
function retriesEnabled(retries: ResolvedOptions["retries"]): boolean {
  if (retries === undefined || retries === false) return false;
  if (typeof retries !== "object" || retries === null) return false;
  return retries.maxAttempts === undefined || retries.maxAttempts > 1;
}

/** Names only the features this agent actually sets, so the error stays actionable. */
function unsupportedFeatures(
  options: ResolvedOptions,
  registration: DurableAgentRegistration,
): string[] {
  const features: string[] = [];
  if (options.memory !== undefined) features.push("memory");
  // Observational hooks are gated by the registration's marker; anything else can change the run.
  if (options.lifecycle !== undefined && registration.lifecycle === undefined)
    features.push("lifecycle");
  // Pure middleware and recorded guardrails are gated by their markers, like lifecycle hooks.
  if ((options.middlewares?.length ?? 0) > 0 && registration.middlewares === undefined)
    features.push("middleware");
  if ((options.guardrails?.length ?? 0) > 0 && registration.guardrails === undefined)
    features.push("guardrails");
  // Static documents are snapshotted into each run record at submission; live vector retrieval
  // is still not checkpointed.
  if ((options.context ?? []).some((input) => isVectorContext(input))) features.push("context");
  if ((options.mcpServers?.length ?? 0) > 0) features.push("MCP servers");
  if ((options.providerTools?.length ?? 0) > 0) features.push("provider tools");
  if ((options.toolIndexes?.length ?? 0) > 0) features.push("tool indexes");
  return features;
}

/**
 * Recorded guardrails key each check by its policy and guardrail id, so two checks with the same id
 * in one list would share a recorded outcome. Reject that at registration instead.
 */
function assertUniqueGuardrailIds(agent: { id: string; guardrails: readonly GuardrailPolicy[] }) {
  const policyIds = new Set<string>();
  for (const policy of agent.guardrails) {
    if (policyIds.has(policy.id))
      throw new TypeError(
        `Durable agent "${agent.id}" has two guardrail policies named "${policy.id}".`,
      );
    policyIds.add(policy.id);
    for (const [boundary, checks] of [
      ["input", policy.input],
      ["output", policy.output],
    ] as const) {
      const ids = new Set<string>();
      for (const check of checks) {
        if (ids.has(check.id))
          throw new TypeError(
            `Durable agent "${agent.id}" has two ${boundary} guardrails named "${check.id}" in policy "${policy.id}".`,
          );
        ids.add(check.id);
      }
    }
  }
}
