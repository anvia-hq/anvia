import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  StudioSession,
  StudioSessionLogEntry,
  StudioSessionSummary,
  StudioTraceSummary,
} from "../../../../types";
import { responseErrorMessage } from "../../app-errors";
import { studioModelMetadataKey } from "../../app-helpers";
import { errorMessage } from "../shared/format";
import type { ActivePage, RunState, SessionLoadState } from "../shared/types";

export function useStudioSessions(props: {
  activePage: ActivePage;
  currentAgentId: string;
  enabled: boolean;
  loadSessionTraceSummaries: (sessionId: string) => Promise<StudioTraceSummary[]>;
  runState: RunState;
  selectedModelRef: string;
  onError: (message: string) => void;
  onSessionCreated: (sessionId: string) => void;
  onSessionDeleted: (sessionId: string, wasSelected: boolean) => void;
  onSessionLoaded: (
    session: StudioSession,
    traceSummaries: StudioTraceSummary[],
    options: { updatePath?: boolean },
  ) => void;
  onStatus: (status: string) => void;
}) {
  const {
    currentAgentId,
    enabled,
    loadSessionTraceSummaries,
    runState,
    selectedModelRef,
    onError,
    onSessionCreated,
    onSessionDeleted,
    onSessionLoaded,
    onStatus,
  } = props;
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [allSessions, setAllSessions] = useState<StudioSessionSummary[]>([]);
  const [sessionLogs, setSessionLogs] = useState<StudioSessionLogEntry[]>([]);
  const [sessionLoadState, setSessionLoadState] = useState<SessionLoadState>("idle");
  const [sessionLogLoadState, setSessionLogLoadState] = useState<SessionLoadState>("idle");
  const sessionLoadRequestRef = useRef("");

  const loadAllSessions = useCallback(async () => {
    if (!enabled) {
      setAllSessions([]);
      return;
    }

    try {
      const response = await fetch("/sessions?limit=100");
      if (!response.ok) {
        throw new Error(`Sessions failed with HTTP ${response.status}`);
      }
      const body = (await response.json()) as { sessions: StudioSessionSummary[] };
      setAllSessions(body.sessions);
    } catch (loadError) {
      onError(errorMessage(loadError));
    }
  }, [enabled, onError]);

  useEffect(() => {
    void loadAllSessions();
  }, [loadAllSessions]);

  const loadSessionLogs = useCallback(
    async (sessionId: string): Promise<StudioSessionLogEntry[]> => {
      if (!enabled) {
        setSessionLogs([]);
        return [];
      }

      setSessionLogLoadState("loading");
      try {
        const params = new URLSearchParams({ limit: "1000" });
        const response = await fetch(`/sessions/${encodeURIComponent(sessionId)}/logs?${params}`);
        if (!response.ok) {
          throw new Error(`Session logs failed with HTTP ${response.status}`);
        }
        const body = (await response.json()) as { logs: StudioSessionLogEntry[] };
        setSessionLogs(body.logs);
        return body.logs;
      } catch (loadError) {
        onError(errorMessage(loadError));
        setSessionLogs([]);
        return [];
      } finally {
        setSessionLogLoadState("idle");
      }
    },
    [enabled, onError],
  );

  const createSession = useCallback(
    async (
      title: string,
      options: { updatePath?: boolean } = {},
    ): Promise<StudioSessionSummary> => {
      const response = await fetch("/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agentId: currentAgentId,
          title,
          metadata: {
            source: "anvia-studio",
            ...(selectedModelRef.length === 0
              ? {}
              : { [studioModelMetadataKey]: selectedModelRef }),
          },
        }),
      });
      if (!response.ok) {
        throw new Error(await responseErrorMessage(response, "Session create failed"));
      }
      const session = (await response.json()) as StudioSessionSummary;
      setSelectedSessionId(session.id);
      setAllSessions((current) => [session, ...current.filter((item) => item.id !== session.id)]);
      if (options.updatePath !== false) {
        onSessionCreated(session.id);
      }
      await loadSessionLogs(session.id);
      return session;
    },
    [currentAgentId, loadSessionLogs, onSessionCreated, selectedModelRef],
  );

  const loadSession = useCallback(
    async (sessionId: string, options: { updatePath?: boolean } = {}) => {
      if (runState === "running") {
        return;
      }

      sessionLoadRequestRef.current = sessionId;
      setSessionLoadState("loading");
      onError("");
      try {
        const response = await fetch(`/sessions/${encodeURIComponent(sessionId)}`);
        if (!response.ok) {
          throw new Error(`Session load failed with HTTP ${response.status}`);
        }
        const session = (await response.json()) as StudioSession;
        const [traceSummaries] = await Promise.all([
          loadSessionTraceSummaries(session.id),
          loadSessionLogs(session.id),
        ]);
        if (sessionLoadRequestRef.current !== sessionId) {
          return;
        }
        setSelectedSessionId(session.id);
        onSessionLoaded(session, traceSummaries, options);
        onStatus("Connected");
      } catch (loadError) {
        if (sessionLoadRequestRef.current === sessionId) {
          onError(errorMessage(loadError));
        }
      } finally {
        if (sessionLoadRequestRef.current === sessionId) {
          setSessionLoadState("idle");
        }
      }
    },
    [loadSessionLogs, loadSessionTraceSummaries, onError, onSessionLoaded, onStatus, runState],
  );

  const deleteSession = useCallback(
    async (session: StudioSessionSummary) => {
      if (runState === "running") {
        return;
      }

      onError("");
      try {
        const response = await fetch(`/sessions/${encodeURIComponent(session.id)}`, {
          method: "DELETE",
        });
        if (!response.ok) {
          throw new Error(`Session delete failed with HTTP ${response.status}`);
        }

        const wasSelected = selectedSessionId === session.id;
        setAllSessions((current) => current.filter((item) => item.id !== session.id));
        if (wasSelected) {
          setSelectedSessionId("");
          setSessionLogs([]);
        }
        onSessionDeleted(session.id, wasSelected);
        onStatus("Connected");
      } catch (deleteError) {
        onError(errorMessage(deleteError));
      }
    },
    [onError, onSessionDeleted, onStatus, runState, selectedSessionId],
  );

  const clearSelectedSession = useCallback(() => {
    setSelectedSessionId("");
    setSessionLogs([]);
  }, []);

  const appendSessionLogEntry = useCallback((log: StudioSessionLogEntry) => {
    setSessionLogs((current) => {
      if (current.some((item) => item.id === log.id)) {
        return current;
      }
      return [...current, log].sort((left, right) => left.sequence - right.sequence);
    });
  }, []);

  return useMemo(
    () => ({
      allSessions,
      selectedSessionId,
      sessionLogs,
      sessionLoadState,
      sessionLogLoadState,
      appendSessionLogEntry,
      clearSelectedSession,
      createSession,
      deleteSession,
      loadAllSessions,
      loadSession,
      loadSessionLogs,
      openSessionPath: onSessionCreated,
      setSelectedSessionId,
    }),
    [
      allSessions,
      appendSessionLogEntry,
      clearSelectedSession,
      createSession,
      deleteSession,
      loadAllSessions,
      loadSession,
      loadSessionLogs,
      onSessionCreated,
      selectedSessionId,
      sessionLoadState,
      sessionLogLoadState,
      sessionLogs,
    ],
  );
}
