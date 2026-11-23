import { createHash } from "node:crypto";
import { z } from "zod";
import type { Agent } from "@anvia/core/agent";
import type { JsonValue } from "@anvia/core/completion";
import { canonicalJson, json } from "./json.js";
import { getResolvedAgentOptions } from "@anvia/core/internal/agent";
import type { DurableAgentRegistration } from "./types.js";

/** The shape `agentVersion()` produces; a hand-written version that looks alike is not one. */
export const AUTO_VERSION_PATTERN = /^auto-[0-9a-f]{16}$/;

/** `version: AUTO_VERSION` in `DurableRuntime.open()` derives the version from `agentVersion()`. */
export const AUTO_VERSION = "auto";

function schemaOf(schema: unknown): JsonValue {
  if (schema === undefined) return null;

  try {
    return json(z.toJSONSchema(schema as z.ZodType));
  } catch {
    return "opaque"; // A schema that has no JSON Schema form cannot contribute.
  }
}

/**
 * The agent's declared configuration as plain data. Functions cannot be fingerprinted, so a tool's
 * implementation, a guardrail, a middleware or a lifecycle hook is not part of it: changing only
 * that code needs a manual version bump.
 */
async function describeAgent(agent: Agent<unknown>): Promise<JsonValue> {
  const tools = await Promise.all(
    agent.tools.map(async (tool) => ({
      name: tool.name,
      definition: json(await tool.definition("")),
      approval: "requiresApproval" in tool && tool.requiresApproval !== undefined,
    })),
  );
  return json({
    id: agent.id,
    provider: agent.model.provider,
    modelId: agent.model.modelId,
    instructions: agent.instructions ?? null,
    temperature: agent.temperature ?? null,
    maxTokens: agent.maxTokens ?? null,
    providerOptions: agent.providerOptions ?? null,
    controls: json(agent.controls ?? null),
    providerTools: json(getResolvedAgentOptions(agent).providerTools ?? []),
    toolChoice: agent.toolChoice ?? null,
    defaultMaxTurns: agent.defaultMaxTurns ?? null,
    outputSchema: schemaOf(agent.outputSchema),
    tools,
  });
}

/**
 * A stable version string derived from an agent's declared configuration: model, instructions,
 * sampling settings and controls, tool definitions, provider tools and output schema. It changes when any of those change and
 * is identical across processes and restarts, so a run recorded under it is refused by a
 * registration that has drifted instead of silently replaying against it.
 *
 * ```ts
 * { agent, version: await agentVersion(agent) }
 * ```
 *
 * It does not cover code the runtime cannot read (tool implementations, guardrails, middlewares,
 * lifecycle hooks), nor MCP servers, tool indexes or context, which have their own fingerprints.
 */
export async function agentVersion(agent: Agent<unknown>): Promise<string> {
  const hash = createHash("sha256")
    .update(canonicalJson(await describeAgent(agent)))
    .digest("hex");
  return `auto-${hash.slice(0, 16)}`;
}

/** Replaces `version: "auto"` with the derived version; other registrations pass through. */
export async function resolveAutoVersions(
  values: readonly DurableAgentRegistration[],
): Promise<DurableAgentRegistration[]> {
  return Promise.all(
    values.map(async (registration) =>
      registration.version === AUTO_VERSION
        ? { ...registration, version: await agentVersion(registration.agent) }
        : registration,
    ),
  );
}
