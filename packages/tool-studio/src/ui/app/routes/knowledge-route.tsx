import { useParams } from "@tanstack/react-router";
import { Suspense, useEffect } from "react";
import { PageLoading } from "../app-pages";
import { KnowledgeContainer } from "../modules/inspectors/inspectors-containers";
import { knowledgeTabFromRoute, useActivatedRoute } from "./route-helpers";

export function KnowledgeRoute() {
  const studio = useActivatedRoute("knowledge");
  const { setKnowledgeTab } = studio;
  const params = useParams({ strict: false }) as { tab?: string };
  const tab = knowledgeTabFromRoute(params.tab);

  useEffect(() => {
    setKnowledgeTab(tab);
  }, [setKnowledgeTab, tab]);

  return (
    <Suspense fallback={<PageLoading />}>
      <KnowledgeContainer
        active
        activeTab={tab}
        enabled={studio.knowledgeEnabled}
        onError={studio.setError}
        onOpenTrace={studio.traces.selectTrace}
        onSelectTab={studio.navigateKnowledgeTab}
      />
    </Suspense>
  );
}
