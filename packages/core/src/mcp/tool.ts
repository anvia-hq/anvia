import type { McpTool } from "./types";

export function isMcpTool(tool: unknown): tool is McpTool {
  if (typeof tool !== "object" || tool === null || !("mcp" in tool)) {
    return false;
  }
  const mcp = tool.mcp;
  return (
    typeof mcp === "object" &&
    mcp !== null &&
    "serverName" in mcp &&
    typeof mcp.serverName === "string" &&
    mcp.serverName.length > 0 &&
    "remoteName" in mcp &&
    typeof mcp.remoteName === "string" &&
    mcp.remoteName.length > 0
  );
}
