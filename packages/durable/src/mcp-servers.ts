import { createHash } from "node:crypto";
import { getResolvedAgentOptions } from "@anvia/core/internal/agent";
import type { Agent } from "@anvia/core/agent";
import { canonicalJson, json } from "./json.js";
import type { DurableAgentRegistration } from "./types.js";

/**
 * The MCP servers of a registered agent, fingerprinted at submission. Discovery happens in the
 * application (`McpClient.connect`) before the agent is built, and each tool's definition is copied
 * at that point, so the fingerprint covers the discovered snapshot: server identity, and each
 * tool's exposed and remote names and its definition. Each call is an ordinary tool operation.
 * Functions (approval predicates, call implementations) cannot be fingerprinted.
 */
export type DurableMcpServers = { hash: string };

export async function mcpServersOf(agent: Agent<unknown>): Promise<DurableMcpServers | undefined> {
  const servers = getResolvedAgentOptions(agent).mcpServers ?? [];
  if (servers.length === 0) return undefined;
  const fingerprint = await Promise.all(
    servers.map(async (server) => ({
      name: server.name,
      serverInfo: json(server.serverInfo ?? null),
      capabilities: json(server.capabilities ?? null),
      instructions: server.instructions ?? null,
      tools: await Promise.all(
        server.tools.map(async (tool) => ({
          name: tool.name,
          serverName: tool.mcp.serverName,
          remoteName: tool.mcp.remoteName,
          definition: json(await tool.definition("")),
        })),
      ),
    })),
  );
  return {
    hash: createHash("sha256")
      .update(canonicalJson(json(fingerprint)))
      .digest("hex"),
  };
}

/** Fingerprints for the registrations that pin their MCP servers, keyed by agent id. */
export async function mcpServersByAgent(
  agents: ReadonlyMap<string, DurableAgentRegistration>,
  agentIds: readonly string[],
): Promise<Map<string, DurableMcpServers>> {
  const result = new Map<string, DurableMcpServers>();
  for (const agentId of new Set(agentIds)) {
    const registration = agents.get(agentId);
    if (registration?.mcpServers === undefined) continue;
    const fingerprint = await mcpServersOf(registration.agent);
    if (fingerprint !== undefined) result.set(agentId, fingerprint);
  }
  return result;
}
