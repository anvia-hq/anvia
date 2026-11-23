import { useParams } from "@tanstack/react-router";
import { Suspense, useEffect, useRef } from "react";
import { PageLoading, TraceBrowser } from "../app-pages";
import { useActivatedRoute } from "./route-helpers";

export function TracingRoute() {
  const studio = useActivatedRoute("tracing");
  const params = useParams({ strict: false }) as {
    traceId?: string;
    sessionId?: string;
  };
  const handledTraceLocationRef = useRef("");

  useEffect(() => {
    const locationKey =
      params.sessionId === undefined
        ? `trace:${params.traceId ?? ""}`
        : `session:${params.sessionId}`;

    if (handledTraceLocationRef.current === locationKey) {
      return;
    }

    if (!studio.pageEnabled("tracing")) {
      return;
    }

    handledTraceLocationRef.current = locationKey;

    if (params.sessionId !== undefined) {
      void studio.traces.showSessionTraces(params.sessionId, { updatePath: false });
      return;
    }

    studio.traces.setTraceLocation(params.traceId ?? "", undefined);
  }, [params.sessionId, params.traceId, studio]);

  return (
    <Suspense fallback={<PageLoading />}>
      <TraceBrowser
        agents={studio.agents}
        traces={studio.traces.traces}
        tracesEnabled={studio.tracesEnabled}
        traceLoadState={studio.traces.traceLoadState}
        selectedTraceId={studio.traces.selectedTraceId}
        traceSessionDetailId={studio.traces.traceSessionDetailId}
        onRefresh={() => void studio.traces.loadTraces()}
        onSelectTrace={studio.traces.selectTrace}
        onShowSessionTraces={(sessionId) => void studio.traces.showSessionTraces(sessionId)}
      />
    </Suspense>
  );
}
