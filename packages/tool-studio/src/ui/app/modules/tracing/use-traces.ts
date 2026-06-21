import { useCallback, useEffect, useMemo, useState } from "react";
import type { StudioTrace, StudioTraceSummary } from "../../../../types";
import { errorMessage } from "../shared/format";
import type { ActivePage, TraceLoadState } from "../shared/types";

export function useTraces(props: {
  activePage: ActivePage;
  enabled: boolean;
  initialTraceId: string;
  initialTraceSessionId: string | undefined;
  onError: (message: string) => void;
  onNavigateTracing: () => void;
  onOpenTrace: (traceId: string) => void;
  onOpenTraceIndex: () => void;
  onOpenTraceSession: (sessionId: string) => void;
}) {
  const {
    activePage,
    enabled,
    onError,
    onNavigateTracing,
    onOpenTrace,
    onOpenTraceIndex,
    onOpenTraceSession,
  } = props;
  const [traces, setTraces] = useState<StudioTrace[]>([]);
  const [selectedTraceId, setSelectedTraceId] = useState(() => props.initialTraceId);
  const [traceSessionDetailId, setTraceSessionDetailId] = useState<string | undefined>(
    () => props.initialTraceSessionId,
  );
  const [traceLoadState, setTraceLoadState] = useState<TraceLoadState>("idle");

  const loadTraces = useCallback(async () => {
    if (!enabled) {
      setTraces([]);
      return;
    }

    setTraceLoadState("loading");
    try {
      const params = new URLSearchParams({ include: "detail", limit: "50" });
      const response = await fetch(`/traces?${params.toString()}`);
      if (!response.ok) {
        throw new Error(`Traces failed with HTTP ${response.status}`);
      }
      const body = (await response.json()) as { traces: StudioTrace[] };
      const loaded = body.traces;
      if (selectedTraceId.length > 0 && !loaded.some((trace) => trace.id === selectedTraceId)) {
        const traceResponse = await fetch(`/traces/${encodeURIComponent(selectedTraceId)}`);
        if (traceResponse.ok) {
          setTraces([(await traceResponse.json()) as StudioTrace, ...loaded]);
          return;
        }
      }
      setTraces(loaded);
    } catch (loadError) {
      onError(errorMessage(loadError));
    } finally {
      setTraceLoadState("idle");
    }
  }, [enabled, onError, selectedTraceId]);

  const showSessionTraces = useCallback(
    async (sessionId: string, options: { updatePath?: boolean } = {}) => {
      if (!enabled) {
        return;
      }

      setTraceLoadState("loading");
      try {
        const params = new URLSearchParams({ include: "detail", limit: "50", sessionId });
        const response = await fetch(`/traces?${params.toString()}`);
        if (!response.ok) {
          throw new Error(`Session traces failed with HTTP ${response.status}`);
        }
        const body = (await response.json()) as { traces: StudioTrace[] };
        const loaded = body.traces;
        const ordered = [...loaded].sort(
          (left, right) => Date.parse(left.startedAt) - Date.parse(right.startedAt),
        );
        setTraces(ordered);
        const firstTraceId = ordered[0]?.id;
        if (firstTraceId === undefined) {
          setSelectedTraceId("");
          setTraceSessionDetailId(sessionId);
          if (options.updatePath !== false) {
            onOpenTraceSession(sessionId);
          }
          return;
        }
        onNavigateTracing();
        setSelectedTraceId(firstTraceId);
        setTraceSessionDetailId(sessionId);
        if (options.updatePath !== false) {
          onOpenTraceSession(sessionId);
        }
      } catch (loadError) {
        onError(errorMessage(loadError));
      } finally {
        setTraceLoadState("idle");
      }
    },
    [enabled, onError, onNavigateTracing, onOpenTraceSession],
  );

  const loadSessionTraceSummaries = useCallback(
    async (sessionId: string): Promise<StudioTraceSummary[]> => {
      if (!enabled) {
        return [];
      }

      const params = new URLSearchParams({ limit: "100" });
      const response = await fetch(`/sessions/${encodeURIComponent(sessionId)}/traces?${params}`);
      if (!response.ok) {
        return [];
      }
      const body = (await response.json()) as { traces: StudioTraceSummary[] };
      return body.traces;
    },
    [enabled],
  );

  useEffect(() => {
    if (activePage !== "tracing" || traceSessionDetailId !== undefined) {
      return;
    }
    void loadTraces();
  }, [activePage, loadTraces, traceSessionDetailId]);

  const setTraceLocation = useCallback((traceId: string, traceSessionId: string | undefined) => {
    setSelectedTraceId(traceId);
    setTraceSessionDetailId(traceSessionId);
  }, []);

  const clearTraceSelection = useCallback(() => {
    setSelectedTraceId("");
    setTraceSessionDetailId(undefined);
  }, []);

  const selectTrace = useCallback(
    (traceId: string) => {
      onNavigateTracing();
      setSelectedTraceId(traceId);
      setTraceSessionDetailId(undefined);
      if (traceId.length === 0) {
        onOpenTraceIndex();
        return;
      }
      onOpenTrace(traceId);
    },
    [onNavigateTracing, onOpenTrace, onOpenTraceIndex],
  );

  const removeSessionTraces = useCallback((sessionId: string) => {
    setTraces((current) => current.filter((trace) => trace.sessionId !== sessionId));
  }, []);

  return useMemo(
    () => ({
      traces,
      selectedTraceId,
      traceSessionDetailId,
      traceLoadState,
      clearTraceSelection,
      loadSessionTraceSummaries,
      loadTraces,
      removeSessionTraces,
      selectTrace,
      setTraceLocation,
      showSessionTraces,
    }),
    [
      clearTraceSelection,
      loadSessionTraceSummaries,
      loadTraces,
      removeSessionTraces,
      selectTrace,
      selectedTraceId,
      setTraceLocation,
      showSessionTraces,
      traceLoadState,
      traceSessionDetailId,
      traces,
    ],
  );
}
