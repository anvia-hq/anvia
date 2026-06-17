import type { ActivePage } from "./types";

export type StudioPageAvailability = {
  hasAgents: boolean;
  sessionsEnabled: boolean;
  tracesEnabled: boolean;
  toolsEnabled: boolean;
  mcpsEnabled: boolean;
  pipelinesEnabled: boolean;
  evalsEnabled: boolean;
  memoryEnabled: boolean;
  statusEnabled: boolean;
  knowledgeEnabled: boolean;
};

export function isActivePageEnabled(
  page: ActivePage,
  availability: StudioPageAvailability,
): boolean {
  if (page === "playground") {
    return availability.hasAgents;
  }
  if (page === "sessions") {
    return availability.sessionsEnabled;
  }
  if (page === "tracing") {
    return availability.tracesEnabled;
  }
  if (page === "tools") {
    return availability.toolsEnabled;
  }
  if (page === "mcps") {
    return availability.mcpsEnabled;
  }
  if (page === "pipelines") {
    return availability.pipelinesEnabled;
  }
  if (page === "evals") {
    return availability.evalsEnabled;
  }
  if (page === "memory") {
    return availability.memoryEnabled;
  }
  if (page === "status") {
    return availability.statusEnabled;
  }
  if (page === "knowledge") {
    return availability.knowledgeEnabled;
  }
  return true;
}

export function fallbackActivePage(
  preferred: ActivePage,
  availability: StudioPageAvailability,
): ActivePage {
  if (isActivePageEnabled(preferred, availability)) {
    return preferred;
  }
  return (
    (
      [
        "playground",
        "pipelines",
        "evals",
        "sessions",
        "tracing",
        "agents",
        "tools",
        "mcps",
        "knowledge",
        "memory",
        "status",
      ] as const
    ).find((page) => isActivePageEnabled(page, availability)) ?? "agents"
  );
}
