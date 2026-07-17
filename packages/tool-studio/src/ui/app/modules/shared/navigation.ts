import type { ActivePage } from "./types";

export type StudioPageAvailability = {
  hasAgents: boolean;
  sessionsEnabled: boolean;
  tracesEnabled: boolean;
  toolsEnabled: boolean;
  sandboxesEnabled: boolean;
  mcpsEnabled: boolean;
  pipelinesEnabled: boolean;
  evalsEnabled: boolean;
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
