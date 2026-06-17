import type { Hono } from "hono";
import type {
  StudioAgent,
  StudioAgentMcpServerMetadata,
  StudioAgentMcpToolMetadata,
} from "../types";
import { errorResponse } from "./http";
import { agentToolItems, mcpServerName } from "./tool-metadata";

export function registerMcpRoutes(
  app: Hono,
  props: {
    agentMap: Map<string, StudioAgent>;
  },
): void {
  app.get("/agents/:agentId/mcps", async (c) => {
    const agentId = c.req.param("agentId");
    const agent = props.agentMap.get(agentId);
    if (agent === undefined) {
      return errorResponse(c, 404, "not_found", "Agent not found");
    }

    return c.json({
      agentId,
      servers: await agentMcpMetadata(agent),
    });
  });
}

export async function agentMcpMetadata(
  agent: StudioAgent,
): Promise<StudioAgentMcpServerMetadata[]> {
  const servers = new Map<string, StudioAgentMcpToolMetadata[]>();
  const seen = new Set<string>();

  for (const { tool, source } of agentToolItems(agent)) {
    const serverName = mcpServerName(tool);
    if (serverName === undefined) {
      continue;
    }

    const definition = await tool.definition("");
    const key = `${serverName}:${source}:${definition.name}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    const tools = servers.get(serverName) ?? [];
    tools.push({
      name: definition.name,
      description: definition.description,
      parameters: definition.parameters,
      source,
    });
    servers.set(serverName, tools);
  }

  return [...servers.entries()]
    .map(([name, tools]) => {
      const sortedTools = tools.sort((left, right) => {
        if (left.source !== right.source) {
          return left.source === "static" ? -1 : 1;
        }
        return left.name.localeCompare(right.name);
      });
      return {
        agentId: agent.id,
        name,
        toolCount: sortedTools.length,
        tools: sortedTools,
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}
