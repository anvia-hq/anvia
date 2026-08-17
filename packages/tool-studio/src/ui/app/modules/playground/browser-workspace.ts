import type { StudioSandboxSummary, StudioSandboxViewSummary } from "../../../../types";

export type BrowserWorkspace = {
  sandboxRef: string;
  view: StudioSandboxViewSummary;
};

export function browserWorkspaceForTool(
  sandboxes: readonly StudioSandboxSummary[],
  agentId: string,
  toolName: string,
): BrowserWorkspace | undefined {
  const matches = sandboxes.flatMap((sandbox) => {
    if (!sandbox.agentIds.includes(agentId) || !sandbox.toolNames.includes(toolName)) return [];
    return sandbox.views
      .filter((view) => view.protocol === "novnc")
      .map((view) => ({ sandboxRef: sandbox.ref, view }));
  });
  return matches.length === 1 ? matches[0] : undefined;
}
