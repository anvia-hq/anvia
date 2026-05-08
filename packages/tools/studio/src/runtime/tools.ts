import type { Hono } from "hono";
import type { StudioAgent, StudioAgentToolMetadata } from "../types";
import { errorResponse } from "./shared";
import { agentToolItems, approvalMetadata } from "./tool-metadata";

export function registerToolRoutes(
  app: Hono,
  props: {
    agentMap: Map<string, StudioAgent>;
  },
): void {
  app.get("/agents/:agentId/tools", async (c) => {
    const agentId = c.req.param("agentId");
    const agent = props.agentMap.get(agentId);
    if (agent === undefined) {
      return errorResponse(c, 404, "not_found", "Agent not found");
    }

    return c.json({
      agentId,
      tools: await agentToolMetadata(agent),
    });
  });
}

export async function agentToolMetadata(agent: StudioAgent): Promise<StudioAgentToolMetadata[]> {
  const seen = new Set<string>();
  const metadata: StudioAgentToolMetadata[] = [];
  for (const { tool, source } of agentToolItems(agent)) {
    const key = `${source}:${tool.name}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const definition = await tool.definition("");
    metadata.push({
      agentId: agent.id,
      name: definition.name,
      description: definition.description,
      parameters: definition.parameters,
      source,
      approval: approvalMetadata(tool),
    });
  }

  return metadata.sort((left, right) => {
    if (left.source !== right.source) {
      return left.source === "static" ? -1 : 1;
    }
    return left.name.localeCompare(right.name);
  });
}
