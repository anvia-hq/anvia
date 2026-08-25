import { Suspense } from "react";
import { GraphsPage, PageLoading } from "../app-pages";
import { useActivatedRoute } from "./route-helpers";

export function GraphsRoute() {
  const studio = useActivatedRoute("graphs");
  return (
    <Suspense fallback={<PageLoading />}>
      <GraphsPage
        graphs={studio.graphs}
        enabled={studio.graphsEnabled}
        theme={studio.resolvedTheme}
        onError={studio.setError}
        onStatus={studio.setStatus}
      />
    </Suspense>
  );
}
