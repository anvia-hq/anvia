import { Outlet } from "@tanstack/react-router";
import { Suspense } from "react";
import { DeleteSessionDialog } from "../../app-pages";
import { useStudioConsole } from "../../studio-console-context";
import { StudioHeader, StudioSidebar } from "./studio-shell";

export function StudioConsoleLayout() {
  const studio = useStudioConsole();

  return (
    <div className="grid h-[100dvh] min-h-0 overflow-hidden bg-background text-foreground lg:grid-cols-[228px_minmax(0,1fr)]">
      <StudioSidebar
        activePage={studio.activePage}
        evalsEnabled={studio.evalsEnabled}
        hasAgents={studio.hasAgents}
        knowledgeEnabled={studio.knowledgeEnabled}
        mcpsEnabled={studio.mcpsEnabled}
        memoryEnabled={studio.memoryEnabled}
        pipelinesEnabled={studio.pipelinesEnabled}
        sessionsEnabled={studio.sessionsEnabled}
        status={studio.status}
        statusEnabled={studio.statusEnabled}
        toolsEnabled={studio.toolsEnabled}
        tracesEnabled={studio.tracesEnabled}
        knowledgeTab={studio.knowledgeTab}
        onNavigate={studio.navigatePage}
        onNavigateKnowledgeTab={studio.navigateKnowledgeTab}
      />

      <main className="grid h-[100dvh] min-w-0 grid-rows-[52px_minmax(0,1fr)] overflow-hidden bg-background/80">
        <StudioHeader
          activePage={studio.activePage}
          selectedAgentLabel={studio.selectedAgent?.name ?? studio.selectedAgent?.id ?? "Agent"}
          sessionsEnabled={studio.sessionsEnabled}
          theme={studio.theme}
          onNavigate={studio.navigatePage}
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
