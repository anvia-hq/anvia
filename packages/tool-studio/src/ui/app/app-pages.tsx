import { lazy } from "react";

export const AgentsPage = lazy(() =>
  import("./modules/agents/agents-page").then((module) => ({
    default: module.AgentsPage,
  })),
);

export const EvalsPage = lazy(() =>
  import("./modules/evals/evals-page").then((module) => ({
    default: module.EvalsPage,
  })),
);

export const KnowledgePage = lazy(() =>
  import("./modules/knowledge/knowledge-page").then((module) => ({
    default: module.KnowledgePage,
  })),
);

export const McpsPage = lazy(() =>
  import("./modules/mcps/mcps-page").then((module) => ({
    default: module.McpsPage,
  })),
);

export const MemoryPage = lazy(() =>
  import("./modules/memory/memory-page").then((module) => ({
    default: module.MemoryPage,
  })),
);

export const PipelinesPage = lazy(() =>
  import("./modules/pipelines/pipelines-page").then((module) => ({
    default: module.PipelinesPage,
  })),
);

export const SessionsPage = lazy(() =>
  import("./modules/sessions/sessions-page").then((module) => ({
    default: module.SessionsPage,
  })),
);

export const SandboxesPage = lazy(() =>
  import("./modules/sandboxes/sandboxes-page").then((module) => ({
    default: module.SandboxesPage,
  })),
);

export const DeleteSessionDialog = lazy(() =>
  import("./modules/sessions/sessions-page").then((module) => ({
    default: module.DeleteSessionDialog,
  })),
);

export const StatusPage = lazy(() =>
  import("./modules/status/status-page").then((module) => ({
    default: module.StatusPage,
  })),
);

export const ToolsPage = lazy(() =>
  import("./modules/tools/tools-page").then((module) => ({
    default: module.ToolsPage,
  })),
);

export const TraceBrowser = lazy(() =>
  import("./modules/tracing/trace-browser").then((module) => ({
    default: module.TraceBrowser,
  })),
);

export function PageLoading() {
  return (
    <section className="grid h-full min-h-0 place-items-center bg-background/45 text-sm font-medium text-muted-foreground">
      Loading
    </section>
  );
}
