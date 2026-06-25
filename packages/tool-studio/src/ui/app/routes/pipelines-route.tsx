import { Suspense, useCallback, useEffect, useState } from "react";
import { PageLoading } from "../app-pages";
import { PipelinesContainer } from "../modules/pipelines/pipelines-container";
import type { PipelineSidebarTab } from "../modules/pipelines/pipelines-page";
import { useActivatedRoute } from "./route-helpers";

export function PipelinesRoute() {
  const studio = useActivatedRoute("pipelines");
  const [activeTab, setActiveTab] = useState<PipelineSidebarTab>(() => tabFromLocation());

  useEffect(() => {
    function syncTabFromLocation() {
      setActiveTab(tabFromLocation());
    }

    window.addEventListener("popstate", syncTabFromLocation);
    return () => window.removeEventListener("popstate", syncTabFromLocation);
  }, []);

  const updateTab = useCallback((tab: PipelineSidebarTab) => {
    setActiveTab(tab);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", tab);
    const nextUrl = `${url.pathname}${url.search}${url.hash}`;
    if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== nextUrl) {
      window.history.pushState(null, "", nextUrl);
    }
  }, []);

  return (
    <Suspense fallback={<PageLoading />}>
      <PipelinesContainer
        active
        activeTab={activeTab}
        pipelines={studio.pipelines}
        enabled={studio.pipelinesEnabled}
        theme={studio.theme}
        onError={studio.setError}
        onStatus={studio.setStatus}
        onTabChange={updateTab}
      />
    </Suspense>
  );
}

function tabFromLocation(): PipelineSidebarTab {
  return pipelineSidebarTab(window.location.search);
}

function pipelineSidebarTab(search: string): PipelineSidebarTab {
  const tab = new URLSearchParams(search).get("tab");
  if (tab === "metadata" || tab === "runs" || tab === "logs") {
    return tab;
  }
  return "input";
}
