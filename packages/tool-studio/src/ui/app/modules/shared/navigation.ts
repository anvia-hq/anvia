import type { ActivePage } from "./types";

export type StudioNavigationSection = "workspace" | "inspect";

const workspacePages: ReadonlySet<ActivePage> = new Set([
  "playground",
  "pipelines",
  "sessions",
  "tracing",
]);

export function navigationSection(page: ActivePage): StudioNavigationSection {
  return workspacePages.has(page) ? "workspace" : "inspect";
}

export type StudioPageAvailability = {
  hasAgents: boolean;
  sessionsEnabled: boolean;
  tracesEnabled: boolean;
  toolsEnabled: boolean;
  sandboxesEnabled: boolean;
  mcpsEnabled: boolean;
  graphsEnabled: boolean;
  pipelinesEnabled: boolean;
  memoryEnabled: boolean;
  statusEnabled: boolean;
  knowledgeEnabled: boolean;
};

export function isActivePageEnabled(
  _page: ActivePage,
  _availability: StudioPageAvailability,
): boolean {
  return true;
}

export function fallbackActivePage(
  preferred: ActivePage,
  _availability: StudioPageAvailability,
): ActivePage {
  return preferred;
}
