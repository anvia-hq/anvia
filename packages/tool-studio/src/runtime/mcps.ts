import type { Hono } from "hono";
import type {
  StudioAgent,
  StudioAgentMcpServerMetadata,
  StudioAgentMcpToolMetadata,
} from "../types";
import { errorResponse } from "./http";
import { approvalMetadata } from "./tool-metadata";

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
  return Promise.all(
    agent.agent.mcpServers.map(async (server) => {
      const tools: StudioAgentMcpToolMetadata[] = await Promise.all(
        server.tools.map(async (tool) => {
          const definition = await tool.definition("");
          return {
            name: definition.name,
            description: definition.description,
            parameters: definition.parameters,
            source: "static" as const,
            approval: approvalMetadata(tool),
          };
        }),
      );
      const sortedTools = tools.sort((left, right) => left.name.localeCompare(right.name));
      return {
        agentId: agent.id,
        name: server.name,
        toolCount: sortedTools.length,
        tools: sortedTools,
      };
    }),
  ).then((servers) => servers.sort((left, right) => left.name.localeCompare(right.name)));
}
