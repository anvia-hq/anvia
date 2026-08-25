import { Outlet } from "@tanstack/react-router";
import { Suspense } from "react";
import { DeleteSessionDialog } from "../../app-pages";
import { useStudioConsole } from "../../studio-console-context";
import { StudioHeader, StudioRail, StudioSidebar } from "./studio-shell";

export function StudioConsoleLayout() {
  const studio = useStudioConsole();
  const navigation = {
    activePage: studio.activePage,
    graphsEnabled: studio.graphsEnabled,
    hasAgents: studio.hasAgents,
    knowledgeEnabled: studio.knowledgeEnabled,
    mcpsEnabled: studio.mcpsEnabled,
    memoryEnabled: studio.memoryEnabled,
    pipelinesEnabled: studio.pipelinesEnabled,
    sandboxesEnabled: studio.sandboxesEnabled,
    sessionsEnabled: studio.sessionsEnabled,
    status: studio.status,
    statusEnabled: studio.statusEnabled,
    toolsEnabled: studio.toolsEnabled,
    tracesEnabled: studio.tracesEnabled,
    knowledgeTab: studio.knowledgeTab,
    onNavigate: studio.navigatePage,
    onNavigateKnowledgeTab: studio.navigateKnowledgeTab,
  };

  return (
    <div className="flex h-[100dvh] min-h-0 overflow-hidden bg-background text-foreground">
      <StudioRail {...navigation} />
      <StudioSidebar {...navigation} />

      <main className="grid h-[100dvh] min-w-0 flex-1 grid-rows-[56px_minmax(0,1fr)] overflow-hidden bg-background">
        <StudioHeader
          activePage={studio.activePage}
          knowledgeTab={studio.knowledgeTab}
          navigation={navigation}
          selectedAgentLabel={
            studio.activePage === "sandboxes"
              ? "Sandboxes"
              : (studio.selectedAgent?.name ?? studio.selectedAgent?.id ?? "Agent")
          }
          sessionsEnabled={studio.sessionsEnabled}
          theme={studio.theme}
          onNewSession={() => studio.startNewChat()}
          onToggleTheme={studio.toggleTheme}
        />
        <Outlet />
      </main>

      <Suspense fallback={null}>
        <DeleteSessionDialog
          session={studio.deleteCandidate}
          onOpenChange={(open) => {
            if (!open) {
              studio.setDeleteCandidate(undefined);
            }
          }}
          onConfirm={(session) => {
            void studio.sessions.deleteSession(session).finally(() => {
              studio.setDeleteCandidate(undefined);
            });
          }}
        />
      </Suspense>
    </div>
  );
}
