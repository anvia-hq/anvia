/**
 * Export-only ACP agent: no generation, server, logging or signal handlers on import.
 * Prerequisites (repository root, Node 22.19.0+ with native type stripping enabled):
 *   pnpm --filter @anvia/cli... --filter @anvia/openai... build
 * Set OPENAI_API_KEY in the root .env; optional OPENAI_BASEURL and ANVIA_ACP_MODEL.
 * The support helper loads that file quietly when a session is created.
 *
 * Zed settings.json: replace /absolute/node with `node -p process.execPath` output,
 * and /absolute/anvia with this checkout's absolute path. Select "Anvia cookbook"
 * for a new External Agent thread. No shell or pnpm script sits on protocol stdout.
 *
 * {
 *   "agent_servers": {
 *     "Anvia cookbook": {
 *       "type": "custom",
 *       "command": "/absolute/node",
 *       "args": [
 *         "/absolute/anvia/packages/cli/dist/cli.js",
 *         "acp",
 *         "--agent",
 *         "/absolute/anvia/cookbook/10_integrations/09-acp-zed-agent.ts"
 *       ],
 *       "env": {}
 *     }
 *   }
 * }
 *
 * Config shape: https://zed.dev/docs/ai/external-agents#custom-agents
 * Manual editor acceptance remains pending; see packages/acp/test/EDITOR_COMPATIBILITY.md.
 * Keep editor MCP forwarding disabled: this example supplies no acpOptions.mcp launch policy.
 * Local protocol entrypoint: pnpm --filter cookbook integrations:09
 * Ask "Which workspace am I in?" and approve/reject the workspace_info tool.
 */
import type { AcpSessionFactory } from "@anvia/acp";
import { Agent } from "@anvia/core/agent";
import { createTool } from "@anvia/core/tool";
import { z } from "zod";
import { createAcpModel } from "./_support/acp-model.ts";

export const sessionFactory: AcpSessionFactory = (context) => {
  const workspaceInfo = createTool({
    name: "workspace_info",
    description: "Report the current ACP workspace directory without reading any files.",
    inputSchema: z.object({}),
    outputSchema: z.object({ cwd: z.string() }),
    requiresApproval: true,
    execute: () => ({ cwd: context.cwd }),
  });

  return {
    agent: new Agent({
      id: context.sessionId,
      model: createAcpModel(),
      instructions:
        "Help explain code and propose changes using the context supplied in chat. " +
        "Use workspace_info when asked which workspace you are in. " +
        "You have no filesystem or terminal access; ask for relevant code when needed.",
      tools: [workspaceInfo, ...context.editorTools],
      mcpServers: context.mcpServers,
      maxTurns: 4,
    }),
    toolPresentation: (call) =>
      call.toolName === workspaceInfo.name
        ? { title: "Show workspace directory", kind: "read" }
        : undefined,
    turnBudget: { maxDurationMs: 5 * 60_000 },
  };
};
