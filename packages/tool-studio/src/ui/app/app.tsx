import { RouterProvider } from "@tanstack/react-router";
import {
  type ChangeEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  StudioConfig,
  StudioSession,
  StudioSessionSummary,
  StudioTraceSummary,
} from "../../types";
import {
  enrichTranscriptWithTraceIds,
  fileToAttachment,
  type PromptAttachment,
  sessionModelRef,
} from "./app-helpers";
import { useStudioTheme } from "./app-theme";
import { useAgentModels } from "./modules/agents/use-agent-models";
import { usePlaygroundRun } from "./modules/playground/use-playground-run";
import { usePlaygroundTranscript } from "./modules/playground/use-playground-transcript";
import { useStudioSessions } from "./modules/sessions/use-studio-sessions";
import { errorMessage } from "./modules/shared/format";
import {
  fallbackActivePage,
  isActivePageEnabled,
  type StudioPageAvailability,
} from "./modules/shared/navigation";
import { defaultKnowledgeTab } from "./modules/shared/path";
import {
  formValue,
  nextSequence,
  resetTranscriptSequence,
  resizeTextarea,
  setTranscriptSequence,
} from "./modules/shared/transcript";
import type { ActivePage, KnowledgeTab, RunState } from "./modules/shared/types";
import { useTraces } from "./modules/tracing/use-traces";
import { StudioConsoleContext } from "./studio-console-context";
import { studioRouter } from "./studio-router";

export function StudioConsole() {
  const [config, setConfig] = useState<StudioConfig | undefined>();
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const transcript = usePlaygroundTranscript();
  const { messages, setMessages } = transcript;
  const [sessionTraceSummaries, setSessionTraceSummaries] = useState<StudioTraceSummary[]>([]);
  const [prompt, setPrompt] = useState("");
  const [attachments, setAttachments] = useState<PromptAttachment[]>([]);
  const [activePage, setActivePage] = useState<ActivePage>("playground");
  const { theme, toggleTheme } = useStudioTheme();
  const [knowledgeTab, setKnowledgeTab] = useState<KnowledgeTab>(defaultKnowledgeTab);
  const [deleteCandidate, setDeleteCandidate] = useState<StudioSessionSummary | undefined>();
  const [status, setStatus] = useState("Loading");
  const [, setError] = useState("");
  const [runState, setRunState] = useState<RunState>("idle");
  const [transcriptResetKey, setTranscriptResetKey] = useState(0);
  const promptRef = useRef<HTMLTextAreaElement | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const transcriptScrollerRef = useRef<HTMLElement | null>(null);
  const transcriptStickToBottomRef = useRef(true);

  function updateTranscriptStickiness() {
    const node = transcriptScrollerRef.current;
    if (node === null) {
      return;
    }
    transcriptStickToBottomRef.current =
      node.scrollHeight - node.scrollTop - node.clientHeight < 80;
  }

  useEffect(() => {
    if (
      activePage !== "playground" ||
      messages.length === 0 ||
      !transcriptStickToBottomRef.current
    ) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      const node = transcriptScrollerRef.current;
      if (node === null) {
        return;
      }
      node.scrollTop = node.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activePage, messages]);

  useEffect(() => {
    if (activePage !== "playground" || typeof ResizeObserver === "undefined") {
      return;
    }
    const scroller = transcriptScrollerRef.current;
    if (scroller === null) {
      return;
    }
    const content = scroller.querySelector<HTMLElement>("[data-studio-transcript-content]");
    if (content === null) {
      return;
    }
    const observer = new ResizeObserver(() => {
      if (transcriptStickToBottomRef.current) {
        scroller.scrollTop = scroller.scrollHeight;
      }
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [activePage]);

  const loadConfig = useCallback(async () => {
    setStatus("Loading");
    setError("");
    try {
      const response = await fetch("/config");
      if (response.status === 401) {
        setStatus("Authentication required");
        return;
      }
      if (!response.ok) {
        throw new Error(`Config failed with HTTP ${response.status}`);
      }

      const nextConfig = (await response.json()) as StudioConfig;
      setConfig(nextConfig);
      setSelectedAgentId((current) => current || nextConfig.agents[0]?.id || "");
      setStatus("Connected");
    } catch (loadError) {
      setError(errorMessage(loadError));
      setStatus("Config error");
    }
  }, []);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  const sessionsEnabled = config?.capabilities.sessions?.enabled === true;
  const tracesEnabled = config?.capabilities.traces?.enabled === true;
  const knowledgeEnabled = config?.capabilities.knowledge?.enabled === true;
  const mcpsEnabled = config?.capabilities.mcps?.enabled === true;
  const toolsEnabled = config?.capabilities.tools?.enabled === true;
  const sandboxesEnabled = config?.capabilities.sandboxes?.enabled === true;
  const pipelinesEnabled = config?.capabilities.pipelines?.enabled === true;
  const evalsEnabled = config?.capabilities.evals?.enabled === true;
  const memoryEnabled = config?.capabilities.memory?.enabled === true;
  const statusEnabled = config?.capabilities.status?.enabled === true;
  const agents = config?.agents ?? [];
  const pipelines = config?.pipelines ?? [];
  const evals = config?.evals ?? [];
  const hasAgents = agents.length > 0;
  const navigateToTracing = useCallback(() => {
    setActivePage("tracing");
  }, []);
  const navigateSessionPath = useCallback((sessionId: string | undefined) => {
    if (sessionId === undefined) {
      void studioRouter.navigate({ to: "/playground" });
      return;
    }
    void studioRouter.navigate({
      to: "/playground/$sessionId",
      params: { sessionId },
    });
  }, []);
  const navigateTraceIndex = useCallback(() => {
    void studioRouter.navigate({ to: "/tracing" });
  }, []);
  const navigateTracePath = useCallback((traceId: string) => {
    void studioRouter.navigate({
      to: "/tracing/$traceId",
      params: { traceId },
    });
  }, []);
  const navigateTraceSessionPath = useCallback((sessionId: string) => {
    void studioRouter.navigate({
      to: "/tracing/sessions/$sessionId",
      params: { sessionId },
    });
  }, []);
  const traces = useTraces({
    activePage,
    enabled: tracesEnabled,
    initialTraceId: "",
    initialTraceSessionId: undefined,
    onError: setError,
    onNavigateTracing: navigateToTracing,
    onOpenTrace: navigateTracePath,
    onOpenTraceIndex: navigateTraceIndex,
    onOpenTraceSession: navigateTraceSessionPath,
  });
  const pageAvailability: StudioPageAvailability = useMemo(
    () => ({
      hasAgents,
      sessionsEnabled,
      tracesEnabled,
      toolsEnabled,
      sandboxesEnabled,
      mcpsEnabled,
      pipelinesEnabled,
      evalsEnabled,
      memoryEnabled,
      statusEnabled,
      knowledgeEnabled,
    }),
    [
      hasAgents,
      sessionsEnabled,
      tracesEnabled,
      toolsEnabled,
      sandboxesEnabled,
      mcpsEnabled,
      pipelinesEnabled,
      evalsEnabled,
      memoryEnabled,
      statusEnabled,
      knowledgeEnabled,
    ],
  );
  const selectedAgent =
    agents.find((agent) => agent.id === selectedAgentId) ?? agents[0] ?? undefined;
  const selectedAgentModelId = selectedAgent?.id;
  const selectedAgentQuickPrompts = selectedAgent?.quickPrompts ?? [];
  const { selectedAgentModels, selectedModelRef, setSelectedModelRef } = useAgentModels({
    enabled: config?.models !== undefined,
    selectedAgentId: selectedAgentModelId,
    onError: setError,
  });
  const hasMessages = messages.length > 0;
  const handleSessionLoaded = useCallback(
    (
      session: StudioSession,
      traceSummaries: StudioTraceSummary[],
      options: { updatePath?: boolean },
    ) => {
      setTranscriptResetKey((current) => current + 1);
      setTranscriptSequence(nextSequence(session.transcript));
      setSelectedAgentId(session.agentId);
      setSelectedModelRef(sessionModelRef(session));
      setSessionTraceSummaries(traceSummaries);
      setMessages(enrichTranscriptWithTraceIds(session.transcript, traceSummaries));
      setAttachments([]);
      if (options.updatePath !== false) {
        setActivePage("playground");
        navigateSessionPath(session.id);
      }
    },
    [navigateSessionPath, setMessages, setSelectedModelRef],
  );
  const handleSessionDeleted = useCallback(
    (sessionId: string, wasSelected: boolean) => {
      traces.removeSessionTraces(sessionId);
      if (!wasSelected) {
        return;
      }
      resetTranscriptSequence();
      setTranscriptResetKey((current) => current + 1);
      setMessages([]);
      setSessionTraceSummaries([]);
      setPrompt("");
      setAttachments([]);
      if (activePage === "playground") {
        navigateSessionPath(undefined);
      }
    },
    [activePage, navigateSessionPath, setMessages, traces],
  );
  const sessions = useStudioSessions({
    activePage,
    currentAgentId: selectedAgent?.id ?? selectedAgentId,
    enabled: sessionsEnabled,
    loadSessionTraceSummaries: traces.loadSessionTraceSummaries,
    runState,
    selectedModelRef,
    onError: setError,
    onSessionCreated: navigateSessionPath,
    onSessionDeleted: handleSessionDeleted,
    onSessionLoaded: handleSessionLoaded,
    onStatus: setStatus,
  });

  const {
    answeringQuestions,
    decidingApprovals,
    isStreaming,
    workingStartedAt,
    answerToolQuestion,
    decideToolApproval,
    runPrompt,
    stopPrompt,
  } = usePlaygroundRun({
    attachments,
    messages,
    promptRef,
    runState,
    selectedAgent,
    selectedAgentId,
    selectedModelRef,
    sessions,
    sessionsEnabled,
    traces,
    transcript,
    onActivePageChange: setActivePage,
    onAttachmentsChange: setAttachments,
    onBeforeRun: () => {
      transcriptStickToBottomRef.current = true;
    },
    onError: setError,
    onPromptChange: setPrompt,
    onRunStateChange: setRunState,
    onSessionTraceSummariesChange: setSessionTraceSummaries,
    onStatus: setStatus,
  });

  const startNewChat = useCallback(
    (options: { updatePath?: boolean } = {}) => {
      if (runState === "running") {
        return;
      }
      resetTranscriptSequence();
      setTranscriptResetKey((current) => current + 1);
      sessions.clearSelectedSession();
      setMessages([]);
      setSessionTraceSummaries([]);
      setPrompt("");
      setAttachments([]);
      setActivePage("playground");
      setError("");
      if (options.updatePath !== false) {
        navigateSessionPath(undefined);
      }
      requestAnimationFrame(() => resizeTextarea(promptRef.current));
    },
    [navigateSessionPath, runState, sessions, setMessages],
  );

  const selectPlaygroundAgent = useCallback(
    (agentId: string) => {
      if (runState === "running" || agentId === selectedAgentId) {
        return;
      }

      setSelectedAgentId(agentId);
      setSelectedModelRef("");
      resetTranscriptSequence();
      setTranscriptResetKey((current) => current + 1);
      sessions.clearSelectedSession();
      setMessages([]);
      setSessionTraceSummaries([]);
      setPrompt("");
      setAttachments([]);
      setActivePage("playground");
      setError("");
      navigateSessionPath(undefined);
      requestAnimationFrame(() => resizeTextarea(promptRef.current));
    },
    [navigateSessionPath, runState, selectedAgentId, sessions, setMessages, setSelectedModelRef],
  );

  function updatePrompt(event: ChangeEvent<HTMLTextAreaElement>) {
    setPrompt(formValue(event));
    resizeTextarea(event.currentTarget);
  }

  async function addPromptAttachments(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    if (files.length === 0) {
      return;
    }

    try {
      const nextAttachments = await Promise.all(files.map(fileToAttachment));
      setAttachments((current) => [...current, ...nextAttachments]);
    } catch (attachmentError) {
      setError(errorMessage(attachmentError));
    }
  }

  function removePromptAttachment(id: string) {
    setAttachments((current) => current.filter((attachment) => attachment.id !== id));
  }

  function handlePromptKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }

    event.preventDefault();
    void runPrompt(prompt);
  }

  const pageEnabled = useCallback(
    (page: ActivePage) => isActivePageEnabled(page, pageAvailability),
    [pageAvailability],
  );

  const navigatePage = useCallback(
    (page: ActivePage) => {
      if (!isActivePageEnabled(page, pageAvailability)) {
        return;
      }

      setActivePage(page);
      if (page === "tracing") {
        traces.clearTraceSelection();
        void studioRouter.navigate({ to: "/tracing" });
        return;
      }
      if (page === "knowledge") {
        traces.clearTraceSelection();
        void studioRouter.navigate({
          to: "/knowledge/$tab",
          params: { tab: knowledgeTab },
        });
        return;
      }
      traces.clearTraceSelection();
      if (page === "playground" && sessions.selectedSessionId.length > 0) {
        navigateSessionPath(sessions.selectedSessionId);
        return;
      }
      void studioRouter.navigate({ to: `/${page}` });
    },
    [knowledgeTab, navigateSessionPath, pageAvailability, sessions.selectedSessionId, traces],
  );

  const navigateFallback = useCallback(
    (preferred: ActivePage) => {
      const nextPage = fallbackActivePage(preferred, pageAvailability);
      navigatePage(nextPage);
    },
    [navigatePage, pageAvailability],
  );

  function navigateKnowledgeTab(tab: KnowledgeTab) {
    setActivePage("knowledge");
    setKnowledgeTab(tab);
    traces.clearTraceSelection();
    void studioRouter.navigate({
      to: "/knowledge/$tab",
      params: { tab },
    });
  }

  const activateRoute = useCallback(
    (page: ActivePage) => {
      if (!isActivePageEnabled(page, pageAvailability)) {
        navigateFallback(page);
        return;
      }
      setActivePage(page);
      if (page !== "tracing") {
        traces.clearTraceSelection();
      }
    },
    [navigateFallback, pageAvailability, traces],
  );

  const contextValue = {
    activePage,
    agents,
    answeringQuestions,
    attachments,
    decidingApprovals,
    deleteCandidate,
    evals,
    evalsEnabled,
    hasAgents,
    hasMessages,
    isStreaming,
    workingStartedAt,
    knowledgeEnabled,
    knowledgeTab,
    mcpsEnabled,
    memoryEnabled,
    messages,
    pageEnabled,
    pipelines,
    pipelinesEnabled,
    prompt,
    runState,
    sandboxesEnabled,
    selectedAgent,
    selectedAgentId,
    selectedAgentModels,
    selectedAgentQuickPrompts,
    selectedModelRef,
    sessionTraceSummaries,
    sessions,
    sessionsEnabled,
    status,
    statusEnabled,
    theme,
    toolsEnabled,
    traces,
    tracesEnabled,
    attachmentInputRef,
    promptRef,
    transcriptScrollerRef,
    transcriptResetKey,
    activateRoute,
    navigateFallback,
    navigatePage,
    navigateKnowledgeTab,
    setDeleteCandidate,
    setError,
    setKnowledgeTab,
    setSelectedModelRef,
    setStatus,
    startNewChat,
    selectPlaygroundAgent,
    addPromptAttachments,
    decideToolApproval,
    updatePrompt,
    handlePromptKeyDown,
    answerToolQuestion,
    removePromptAttachment,
    runPrompt,
    stopPrompt,
    toggleTheme,
    updateTranscriptStickiness,
  };

  return (
    <StudioConsoleContext.Provider value={contextValue}>
      <RouterProvider router={studioRouter} />
    </StudioConsoleContext.Provider>
  );
}
