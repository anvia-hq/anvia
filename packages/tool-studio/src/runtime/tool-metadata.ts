import { getAgentToolState } from "@anvia/core/internal/agent";
import { isMcpTool } from "@anvia/core/mcp";
import type { AnyTool } from "@anvia/core/tool";
import type { StudioAgent, StudioAgentToolApprovalMetadata, StudioAgentToolSource } from "../types";

export type AgentToolItem = {
  tool: AnyTool;
  source: StudioAgentToolSource;
};

export function agentToolItems(agent: StudioAgent): AgentToolItem[] {
  const state = getAgentToolState(agent.agent);
  const items: AgentToolItem[] = state.staticTools.map((tool) => ({ tool, source: "static" }));
  const names = new Set(items.map(({ tool }) => tool.name));

  for (const index of state.toolIndexes) {
    for (const tool of index.tools) {
      if (!names.has(tool.name)) {
        names.add(tool.name);
        items.push({ tool, source: "dynamic" });
      }
    }
  }

  return items;
}

export function approvalMetadata(tool: AnyTool): StudioAgentToolApprovalMetadata {
  const approval = tool.requiresApproval;
  if (approval === undefined || approval === false) {
    return { required: false };
  }

  if (typeof approval !== "object" || approval === null) {
    return { required: true };
  }

  const policy = approval as { reason?: unknown };
  const metadata: StudioAgentToolApprovalMetadata = { required: true };
  if (typeof policy.reason === "string") metadata.reason = policy.reason;
  return metadata;
}

export function toolRequiresApproval(tool: AnyTool): boolean {
  const approval = tool.requiresApproval;
  return approval !== undefined && approval !== false;
}

export function mcpServerName(tool: AnyTool): string | undefined {
  return isMcpTool(tool) ? tool.mcp.serverName : undefined;
}

export function agentHasMcpServers(agent: StudioAgent): boolean {
  return agent.agent.mcpServers.length > 0;
}
