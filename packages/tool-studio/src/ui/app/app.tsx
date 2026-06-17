import type { Message, ToolResultContent, UserContent } from "@anvia/core/completion";
import { createChatTransport, EventStreamHttpError, useChat } from "@anvia/react";
import {
  Archive,
  ArrowSquareOut,
  ArrowUp,
  Moon,
  Paperclip,
  Plus,
  Sun,
  X,
} from "@phosphor-icons/react";
import {
  type ChangeEvent,
  type KeyboardEvent,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  AgentRunStreamEvent,
  StudioAgentMcpsSummary,
  StudioAgentModelsSummary,
  StudioAgentToolsSummary,
  StudioConfig,
  StudioEvalRunResponse,
  StudioKnowledgeSummary,
  StudioModelSummary,
  StudioPipelineDetail,
  StudioPipelineLogEntry,
  StudioPipelineRunRecord,
  StudioSession,
  StudioSessionLogEntry,
  StudioSessionSummary,
  StudioTrace,
  StudioTraceSummary,
  StudioTranscriptChildAgentEvent,
} from "../../types";
import { Button } from "./components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./components/ui/select";
import { Textarea } from "./components/ui/textarea";
import { cn } from "./lib/utils";
import { SessionLogsPanel } from "./modules/session-logs/session-logs-panel";
import {
  errorMessage,
  formatRelativeTime,
  formatToolValue,
  titleFromText,
} from "./modules/shared/format";
import {
  fallbackActivePage,
  isActivePageEnabled,
  type StudioPageAvailability,
} from "./modules/shared/navigation";
import {
  defaultKnowledgeTab,
  logoSrc,
  pageLocationFromLocation,
  updateKnowledgePath,
  updatePagePath,
  updateSessionPath,
  updateTracePath,
  updateTraceSessionPath,
} from "./modules/shared/path";
import {
  findMatchingToolIndex,
  findMatchingToolIndexByCall,
  formValue,
  nextPaint,
  nextSequence,
  nextTranscriptId,
  readJsonl,
  resetTranscriptSequence,
  resizeTextarea,
  setTranscriptSequence,
  toHistory,
} from "./modules/shared/transcript";
import type {
  ActivePage,
  KnowledgeTab,
  RunState,
  SessionLoadState,
  ToolApprovalUpdate,
  ToolQuestionUpdate,
  TraceLoadState,
  TranscriptEntry,
} from "./modules/shared/types";
import { NavButton } from "./modules/shell/nav-button";

const AgentsPage = lazy(() =>
  import("./modules/agents/agents-page").then((module) => ({
    default: module.AgentsPage,
  })),
);
const EvalsPage = lazy(() =>
  import("./modules/evals/evals-page").then((module) => ({
    default: module.EvalsPage,
  })),
);
const KnowledgePage = lazy(() =>
  import("./modules/knowledge/knowledge-page").then((module) => ({
    default: module.KnowledgePage,
  })),
);
const McpsPage = lazy(() =>
  import("./modules/mcps/mcps-page").then((module) => ({
    default: module.McpsPage,
  })),
);
const MemoryPage = lazy(() =>
  import("./modules/memory/memory-page").then((module) => ({
    default: module.MemoryPage,
  })),
);
const PipelinesPage = lazy(() =>
  import("./modules/pipelines/pipelines-page").then((module) => ({
    default: module.PipelinesPage,
  })),
);
const SessionsPage = lazy(() =>
  import("./modules/sessions/sessions-page").then((module) => ({
    default: module.SessionsPage,
  })),
);
const DeleteSessionDialog = lazy(() =>
  import("./modules/sessions/sessions-page").then((module) => ({
    default: module.DeleteSessionDialog,
  })),
);
const StatusPage = lazy(() =>
  import("./modules/status/status-page").then((module) => ({
    default: module.StatusPage,
  })),
);
const ToolsPage = lazy(() =>
  import("./modules/tools/tools-page").then((module) => ({
    default: module.ToolsPage,
  })),
);
const TraceBrowser = lazy(() =>
  import("./modules/tracing/trace-browser").then((module) => ({
    default: module.TraceBrowser,
  })),
);
const TranscriptItem = lazy(() =>
  import("./modules/playground/transcript-item").then((module) => ({
    default: module.TranscriptItem,
  })),
);

type StudioTheme = "light" | "dark";

type StudioAgentRunRequest = {
  agentId: string;
  message: string | Message;
  sessionId?: string;
  history?: Message[];
  model?: string;
  stream: true;
  metadata: {
    source: string;
    studioModel?: string;
  };
};

const studioModelMetadataKey = "studioModel";
const supportedAttachmentTypes = ".png,.jpg,.jpeg,.webp,.gif,.pdf,.txt,.md,.csv,.json";

type PromptAttachment = {
  id: string;
  name: string;
  mediaType: string;
  kind: "image" | "document";
  data: string;
  size: number;
};

const studioThemeStorageKey = "anvia-studio-theme";

function readInitialStudioTheme(): StudioTheme {
  if (typeof window === "undefined") {
    return "dark";
  }
  try {
    const stored = window.localStorage.getItem(studioThemeStorageKey);
    return stored === "light" || stored === "dark" ? stored : "dark";
  } catch {
    return "dark";
  }
}

function applyStudioTheme(theme: StudioTheme): void {
  if (typeof document === "undefined") {
    return;
  }
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.style.colorScheme = theme;
}

function storeStudioTheme(theme: StudioTheme): void {
  try {
    window.localStorage.setItem(studioThemeStorageKey, theme);
  } catch {
    // Ignore storage failures so private or restricted browsing still toggles the UI.
  }
}

const initialStudioTheme = readInitialStudioTheme();
applyStudioTheme(initialStudioTheme);

async function responseErrorMessage(response: Response, label: string): Promise<string> {
  let detail = "";
  try {
    const body = (await response.json()) as unknown;
    if (
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof body.error === "object" &&
      body.error !== null &&
      "message" in body.error &&
      typeof body.error.message === "string"
    ) {
      detail = `: ${body.error.message}`;
    }
  } catch {
    // Ignore non-JSON error bodies.
  }
  return `${label} with HTTP ${response.status}${detail}`;
}

function agentRunErrorMessage(error: unknown): string {
  if (error instanceof EventStreamHttpError) {
    return error.response.status === 401
      ? "Authentication required"
      : `Run failed with HTTP ${error.response.status}`;
  }
  return errorMessage(error);
}

function serializedStreamErrorText(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}

export function StudioConsole() {
  const initialLocation = pageLocationFromLocation();
  const [config, setConfig] = useState<StudioConfig | undefined>();
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [mcpsAgentId, setMcpsAgentId] = useState("");
  const [toolsAgentId, setToolsAgentId] = useState("");
  const [selectedPipelineId, setSelectedPipelineId] = useState("");
  const [selectedEvalId, setSelectedEvalId] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [allSessions, setAllSessions] = useState<StudioSessionSummary[]>([]);
  const [traces, setTraces] = useState<StudioTrace[]>([]);
  const [sessionLogs, setSessionLogs] = useState<StudioSessionLogEntry[]>([]);
  const [pipelineDetail, setPipelineDetail] = useState<StudioPipelineDetail | undefined>();
  const [pipelineLogs, setPipelineLogs] = useState<StudioPipelineLogEntry[]>([]);
  const [pipelineRuns, setPipelineRuns] = useState<StudioPipelineRunRecord[]>([]);
  const [messages, setMessages] = useState<TranscriptEntry[]>([]);
  const [prompt, setPrompt] = useState("");
  const [attachments, setAttachments] = useState<PromptAttachment[]>([]);
  const [pipelineRunInput, setPipelineRunInput] = useState('"Hello from Studio"');
  const [pipelineRunOutput, setPipelineRunOutput] = useState("");
  const [evalRunResult, setEvalRunResult] = useState<StudioEvalRunResponse | undefined>();
  const [activePipelineRunId, setActivePipelineRunId] = useState("");
  const [activePage, setActivePage] = useState<ActivePage>(() => initialLocation.page);
  const [theme, setTheme] = useState<StudioTheme>(() => initialStudioTheme);
  const [knowledgeTab, setKnowledgeTab] = useState<KnowledgeTab>(
    () => initialLocation.knowledgeTab ?? defaultKnowledgeTab,
  );
  const [selectedTraceId, setSelectedTraceId] = useState(() => initialLocation.traceId ?? "");
  const [traceSessionDetailId, setTraceSessionDetailId] = useState<string | undefined>(
    () => initialLocation.traceSessionId,
  );
  const [deleteCandidate, setDeleteCandidate] = useState<StudioSessionSummary | undefined>();
  const [status, setStatus] = useState("Loading");
  const [, setError] = useState("");
  const [runState, setRunState] = useState<RunState>("idle");
  const [decidingApprovals, setDecidingApprovals] = useState<Set<string>>(() => new Set());
  const [answeringQuestions, setAnsweringQuestions] = useState<Set<string>>(() => new Set());
  const [sessionLoadState, setSessionLoadState] = useState<SessionLoadState>("idle");
  const [sessionLogLoadState, setSessionLogLoadState] = useState<SessionLoadState>("idle");
  const [traceLoadState, setTraceLoadState] = useState<TraceLoadState>("idle");
  const [knowledge, setKnowledge] = useState<StudioKnowledgeSummary | undefined>();
  const [knowledgeLoadState, setKnowledgeLoadState] = useState<"idle" | "loading">("idle");
  const [mcps, setMcps] = useState<StudioAgentMcpsSummary | undefined>();
  const [mcpsLoadState, setMcpsLoadState] = useState<"idle" | "loading">("idle");
  const [tools, setTools] = useState<StudioAgentToolsSummary | undefined>();
  const [toolsLoadState, setToolsLoadState] = useState<"idle" | "loading">("idle");
  const [agentModels, setAgentModels] = useState<StudioAgentModelsSummary | undefined>();
  const [selectedModelRef, setSelectedModelRef] = useState("");
  const [pipelineDetailLoadState, setPipelineDetailLoadState] = useState<"idle" | "loading">(
    "idle",
  );
  const [pipelineLogLoadState, setPipelineLogLoadState] = useState<"idle" | "loading">("idle");
  const [pipelineRunLoadState, setPipelineRunLoadState] = useState<"idle" | "loading">("idle");
  const [pipelineRunState, setPipelineRunState] = useState<RunState>("idle");
  const [evalRunState, setEvalRunState] = useState<RunState>("idle");
  const promptRef = useRef<HTMLTextAreaElement | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const transcriptScrollerRef = useRef<HTMLElement | null>(null);
  const transcriptStickToBottomRef = useRef(true);
  const playgroundRunRequestRef = useRef<StudioAgentRunRequest | undefined>(undefined);
  const playgroundRunErrorRef = useRef<unknown>(undefined);
  const playgroundVisibleEventRef = useRef<Promise<void>>(Promise.resolve());

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
      setMcpsAgentId((current) => current || nextConfig.agents[0]?.id || "");
      setToolsAgentId((current) => current || nextConfig.agents[0]?.id || "");
      setSelectedPipelineId((current) => current || nextConfig.pipelines[0]?.id || "");
      setSelectedEvalId((current) => current || nextConfig.evals[0]?.id || "");
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
  const pipelinesEnabled = config?.capabilities.pipelines?.enabled === true;
  const evalsEnabled = config?.capabilities.evals?.enabled === true;
  const memoryEnabled = config?.capabilities.memory?.enabled === true;
  const statusEnabled = config?.capabilities.status?.enabled === true;
  const agents = config?.agents ?? [];
  const pipelines = config?.pipelines ?? [];
  const evals = config?.evals ?? [];
  const hasAgents = agents.length > 0;
  const pageAvailability: StudioPageAvailability = useMemo(
    () => ({
      hasAgents,
      sessionsEnabled,
      tracesEnabled,
      toolsEnabled,
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
  const selectedAgentModels =
    agentModels !== undefined && agentModels.agentId === selectedAgent?.id
      ? agentModels.models
      : [];
  const hasMessages = messages.length > 0;

  useEffect(() => {
    if (config?.models === undefined || selectedAgentModelId === undefined) {
      setAgentModels(undefined);
      setSelectedModelRef("");
      return;
    }

    const agentId = selectedAgentModelId;
    let cancelled = false;
    async function loadAgentModels() {
      try {
        const response = await fetch(`/agents/${encodeURIComponent(agentId)}/models`);
        if (!response.ok) {
          throw new Error(`Agent models failed with HTTP ${response.status}`);
        }
        const body = (await response.json()) as StudioAgentModelsSummary;
        if (cancelled) {
          return;
        }
        setAgentModels(body);
        setSelectedModelRef((current) =>
          modelRefAvailable(body.models, current)
            ? current
            : (body.defaultModel ?? body.models[0]?.ref ?? ""),
        );
      } catch (loadError) {
        if (!cancelled) {
          setAgentModels(undefined);
          setError(errorMessage(loadError));
        }
      }
    }

    void loadAgentModels();
    return () => {
      cancelled = true;
    };
  }, [config?.models, selectedAgentModelId]);

  const playgroundChat = useChat<StudioAgentRunRequest, AgentRunStreamEvent>({
    transport: createChatTransport<StudioAgentRunRequest, AgentRunStreamEvent>({
      endpoint: (request) => `/agents/${encodeURIComponent(request.agentId)}/runs`,
      method: "POST",
      format: "jsonl",
      headers: {
        "content-type": "application/json",
      },
      body: (request) => {
        const { agentId: _agentId, ...body } = request;
        return JSON.stringify(body);
      },
      mapEvent: (event) => event as AgentRunStreamEvent,
    }),
    createRequest: () => {
      const request = playgroundRunRequestRef.current;
      if (request === undefined) {
        throw new Error("Missing playground run request");
      }
      return request;
    },
    eventToDelta: () => undefined,
    eventToFinal: () => undefined,
    onEvent(event) {
      const visibleDelta = acceptStreamEvent(event);
      if (visibleDelta) {
        playgroundVisibleEventRef.current = playgroundVisibleEventRef.current.then(nextPaint);
      }
    },
    onError(error) {
      playgroundRunErrorRef.current = error;
      const message = agentRunErrorMessage(error);
      setError(message);
      appendAssistantError(message);
    },
  });

  useEffect(() => {
    applyStudioTheme(theme);
    storeStudioTheme(theme);
  }, [theme]);

  useEffect(() => {
    setRunState(playgroundChat.status === "streaming" ? "running" : "idle");
  }, [playgroundChat.status]);

  const loadAllSessions = useCallback(async () => {
    if (!sessionsEnabled) {
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
      setError(errorMessage(loadError));
    }
  }, [sessionsEnabled]);

  useEffect(() => {
    void loadAllSessions();
  }, [loadAllSessions]);

  const loadSessionLogs = useCallback(
    async (sessionId: string): Promise<StudioSessionLogEntry[]> => {
      if (!sessionsEnabled) {
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
        setError(errorMessage(loadError));
        setSessionLogs([]);
        return [];
      } finally {
        setSessionLogLoadState("idle");
      }
    },
    [sessionsEnabled],
  );

  async function createSession(title: string): Promise<StudioSessionSummary> {
    const agentId = selectedAgent?.id ?? selectedAgentId;
    const response = await fetch("/sessions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        agentId,
        title,
        metadata: {
          source: "anvia-studio",
          ...(selectedModelRef.length === 0 ? {} : { [studioModelMetadataKey]: selectedModelRef }),
        },
      }),
    });
    if (!response.ok) {
      throw new Error(await responseErrorMessage(response, "Session create failed"));
    }
    const session = (await response.json()) as StudioSessionSummary;
    setSelectedSessionId(session.id);
    setAllSessions((current) => [session, ...current.filter((item) => item.id !== session.id)]);
    updateSessionPath(session.id);
    await loadSessionLogs(session.id);
    return session;
  }

  const loadTraces = useCallback(async () => {
    if (!tracesEnabled) {
      setTraces([]);
      return;
    }

    setTraceLoadState("loading");
    try {
      const params = new URLSearchParams({ limit: "50" });
      const response = await fetch(`/traces?${params.toString()}`);
      if (!response.ok) {
        throw new Error(`Traces failed with HTTP ${response.status}`);
      }
      const body = (await response.json()) as { traces: StudioTraceSummary[] };
      const loaded = await Promise.all(
        body.traces.map(async (trace) => {
          const traceResponse = await fetch(`/traces/${encodeURIComponent(trace.id)}`);
          if (!traceResponse.ok) {
            throw new Error(`Trace load failed with HTTP ${traceResponse.status}`);
          }
          return (await traceResponse.json()) as StudioTrace;
        }),
      );
      if (selectedTraceId.length > 0 && !loaded.some((trace) => trace.id === selectedTraceId)) {
        const traceResponse = await fetch(`/traces/${encodeURIComponent(selectedTraceId)}`);
        if (traceResponse.ok) {
          setTraces([(await traceResponse.json()) as StudioTrace, ...loaded]);
          return;
        }
      }
      setTraces(loaded);
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setTraceLoadState("idle");
    }
  }, [selectedTraceId, tracesEnabled]);

  const showSessionTraces = useCallback(
    async (sessionId: string, options: { updatePath?: boolean } = {}) => {
      if (!tracesEnabled) {
        return;
      }

      setTraceLoadState("loading");
      try {
        const params = new URLSearchParams({ limit: "50", sessionId });
        const response = await fetch(`/traces?${params.toString()}`);
        if (!response.ok) {
          throw new Error(`Session traces failed with HTTP ${response.status}`);
        }
        const body = (await response.json()) as { traces: StudioTraceSummary[] };
        const loaded = await Promise.all(
          body.traces.map(async (trace) => {
            const traceResponse = await fetch(`/traces/${encodeURIComponent(trace.id)}`);
            if (!traceResponse.ok) {
              throw new Error(`Trace load failed with HTTP ${traceResponse.status}`);
            }
            return (await traceResponse.json()) as StudioTrace;
          }),
        );
        const ordered = [...loaded].sort(
          (left, right) => Date.parse(left.startedAt) - Date.parse(right.startedAt),
        );
        setTraces(ordered);
        const firstTraceId = ordered[0]?.id;
        if (firstTraceId === undefined) {
          setSelectedTraceId("");
          setTraceSessionDetailId(sessionId);
          if (options.updatePath !== false) {
            updateTraceSessionPath(sessionId);
          }
          return;
        }
        setActivePage("tracing");
        setSelectedTraceId(firstTraceId);
        setTraceSessionDetailId(sessionId);
        if (options.updatePath !== false) {
          updateTraceSessionPath(sessionId);
        }
      } catch (loadError) {
        setError(errorMessage(loadError));
      } finally {
        setTraceLoadState("idle");
      }
    },
    [tracesEnabled],
  );

  const loadSessionTraceSummaries = useCallback(
    async (sessionId: string): Promise<StudioTraceSummary[]> => {
      if (!tracesEnabled) {
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
    [tracesEnabled],
  );

  useEffect(() => {
    if (activePage !== "tracing" || traceSessionDetailId !== undefined) {
      return;
    }
    void loadTraces();
  }, [activePage, loadTraces, traceSessionDetailId]);

  const loadKnowledge = useCallback(async () => {
    if (!knowledgeEnabled) {
      setKnowledge(undefined);
      return;
    }

    setKnowledgeLoadState("loading");
    try {
      const response = await fetch("/knowledge?limit=25");
      if (!response.ok) {
        throw new Error(`Knowledge failed with HTTP ${response.status}`);
      }
      setKnowledge((await response.json()) as StudioKnowledgeSummary);
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setKnowledgeLoadState("idle");
    }
  }, [knowledgeEnabled]);

  useEffect(() => {
    if (activePage === "knowledge") {
      void loadKnowledge();
    }
  }, [activePage, loadKnowledge]);

  const loadMcps = useCallback(
    async (agentId: string) => {
      if (!mcpsEnabled || agentId.length === 0) {
        setMcps(undefined);
        return;
      }

      setMcpsLoadState("loading");
      try {
        const response = await fetch(`/agents/${encodeURIComponent(agentId)}/mcps`);
        if (!response.ok) {
          throw new Error(`MCPs failed with HTTP ${response.status}`);
        }
        setMcps((await response.json()) as StudioAgentMcpsSummary);
      } catch (loadError) {
        setError(errorMessage(loadError));
        setMcps(undefined);
      } finally {
        setMcpsLoadState("idle");
      }
    },
    [mcpsEnabled],
  );

  useEffect(() => {
    if (activePage === "mcps") {
      void loadMcps(mcpsAgentId || selectedAgentId);
    }
  }, [activePage, loadMcps, mcpsAgentId, selectedAgentId]);

  const loadTools = useCallback(
    async (agentId: string) => {
      if (!toolsEnabled || agentId.length === 0) {
        setTools(undefined);
        return;
      }

      setToolsLoadState("loading");
      try {
        const response = await fetch(`/agents/${encodeURIComponent(agentId)}/tools`);
        if (!response.ok) {
          throw new Error(`Tools failed with HTTP ${response.status}`);
        }
        setTools((await response.json()) as StudioAgentToolsSummary);
      } catch (loadError) {
        setError(errorMessage(loadError));
        setTools(undefined);
      } finally {
        setToolsLoadState("idle");
      }
    },
    [toolsEnabled],
  );

  useEffect(() => {
    if (activePage === "tools") {
      void loadTools(toolsAgentId || selectedAgentId);
    }
  }, [activePage, loadTools, selectedAgentId, toolsAgentId]);

  const loadPipelineLogs = useCallback(
    async (pipelineId: string): Promise<StudioPipelineLogEntry[]> => {
      if (!pipelinesEnabled || pipelineId.length === 0) {
        setPipelineLogs([]);
        return [];
      }

      setPipelineLogLoadState("loading");
      try {
        const params = new URLSearchParams({ limit: "1000" });
        const response = await fetch(`/pipelines/${encodeURIComponent(pipelineId)}/logs?${params}`);
        if (!response.ok) {
          throw new Error(`Pipeline logs failed with HTTP ${response.status}`);
        }
        const body = (await response.json()) as { logs: StudioPipelineLogEntry[] };
        setPipelineLogs(body.logs);
        return body.logs;
      } catch (loadError) {
        setError(errorMessage(loadError));
        setPipelineLogs([]);
        return [];
      } finally {
        setPipelineLogLoadState("idle");
      }
    },
    [pipelinesEnabled],
  );

  const loadPipelineRuns = useCallback(
    async (pipelineId: string): Promise<StudioPipelineRunRecord[]> => {
      if (!pipelinesEnabled || pipelineId.length === 0) {
        setPipelineRuns([]);
        return [];
      }

      setPipelineRunLoadState("loading");
      try {
        const params = new URLSearchParams({ limit: "50" });
        const response = await fetch(`/pipelines/${encodeURIComponent(pipelineId)}/runs?${params}`);
        if (!response.ok) {
          throw new Error(`Pipeline runs failed with HTTP ${response.status}`);
        }
        const body = (await response.json()) as { runs: StudioPipelineRunRecord[] };
        setPipelineRuns(body.runs);
        return body.runs;
      } catch (loadError) {
        setError(errorMessage(loadError));
        setPipelineRuns([]);
        return [];
      } finally {
        setPipelineRunLoadState("idle");
      }
    },
    [pipelinesEnabled],
  );

  const loadPipeline = useCallback(
    async (pipelineId: string) => {
      if (!pipelinesEnabled || pipelineId.length === 0) {
        setPipelineDetail(undefined);
        setPipelineLogs([]);
        setPipelineRuns([]);
        return;
      }

      setPipelineDetailLoadState("loading");
      setError("");
      try {
        const response = await fetch(`/pipelines/${encodeURIComponent(pipelineId)}`);
        if (!response.ok) {
          throw new Error(`Pipeline load failed with HTTP ${response.status}`);
        }
        setSelectedPipelineId(pipelineId);
        setPipelineDetail((await response.json()) as StudioPipelineDetail);
        await Promise.all([loadPipelineLogs(pipelineId), loadPipelineRuns(pipelineId)]);
      } catch (loadError) {
        setError(errorMessage(loadError));
        setPipelineDetail(undefined);
      } finally {
        setPipelineDetailLoadState("idle");
      }
    },
    [loadPipelineLogs, loadPipelineRuns, pipelinesEnabled],
  );

  useEffect(() => {
    if (activePage !== "pipelines") {
      return;
    }
    const pipelineId = selectedPipelineId || config?.pipelines[0]?.id || "";
    if (pipelineId.length > 0) {
      void loadPipeline(pipelineId);
    }
  }, [activePage, config?.pipelines, loadPipeline, selectedPipelineId]);

  const loadSession = useCallback(
    async (sessionId: string, options: { updatePath?: boolean } = {}) => {
      if (runState === "running") {
        return;
      }

      setSessionLoadState("loading");
      setError("");
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
        setTranscriptSequence(nextSequence(session.transcript));
        setSelectedAgentId(session.agentId);
        setSelectedModelRef(sessionModelRef(session));
        setSelectedSessionId(session.id);
        setMessages(enrichTranscriptWithTraceIds(session.transcript, traceSummaries));
        setAttachments([]);
        if (options.updatePath !== false) {
          setActivePage("playground");
          updateSessionPath(session.id);
        }
        setStatus("Connected");
      } catch (loadError) {
        setError(errorMessage(loadError));
      } finally {
        setSessionLoadState("idle");
      }
    },
    [runState, loadSessionTraceSummaries, loadSessionLogs],
  );

  const startNewChat = useCallback(
    (options: { updatePath?: boolean } = {}) => {
      if (runState === "running") {
        return;
      }
      resetTranscriptSequence();
      setSelectedSessionId("");
      setSessionLogs([]);
      setMessages([]);
      setPrompt("");
      setAttachments([]);
      setActivePage("playground");
      setError("");
      if (options.updatePath !== false) {
        updateSessionPath(undefined);
      }
      requestAnimationFrame(() => resizeTextarea(promptRef.current));
    },
    [runState],
  );

  const selectPlaygroundAgent = useCallback(
    (agentId: string) => {
      if (runState === "running" || agentId === selectedAgentId) {
        return;
      }

      setSelectedAgentId(agentId);
      setSelectedModelRef("");
      resetTranscriptSequence();
      setSelectedSessionId("");
      setSessionLogs([]);
      setMessages([]);
      setPrompt("");
      setAttachments([]);
      setActivePage("playground");
      setError("");
      updateSessionPath(undefined);
      requestAnimationFrame(() => resizeTextarea(promptRef.current));
    },
    [runState, selectedAgentId],
  );

  async function deleteSession(session: StudioSessionSummary) {
    if (runState === "running") {
      return;
    }

    setError("");
    try {
      const response = await fetch(`/sessions/${encodeURIComponent(session.id)}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error(`Session delete failed with HTTP ${response.status}`);
      }

      setAllSessions((current) => current.filter((item) => item.id !== session.id));
      setTraces((current) => current.filter((trace) => trace.sessionId !== session.id));
      if (selectedSessionId === session.id) {
        resetTranscriptSequence();
        setSelectedSessionId("");
        setSessionLogs([]);
        setMessages([]);
        setPrompt("");
        setAttachments([]);
        if (activePage === "playground") {
          updateSessionPath(undefined);
        }
      }
      setStatus("Connected");
    } catch (deleteError) {
      setError(errorMessage(deleteError));
    } finally {
      setDeleteCandidate(undefined);
    }
  }

  useEffect(() => {
    if (!sessionsEnabled) {
      return;
    }

    const location = pageLocationFromLocation();
    setActivePage(location.page);
    setKnowledgeTab(location.knowledgeTab ?? defaultKnowledgeTab);
    setSelectedTraceId(location.traceId ?? "");
    setTraceSessionDetailId(location.traceSessionId);
    if (location.page === "tracing" && location.traceSessionId !== undefined) {
      void showSessionTraces(location.traceSessionId, { updatePath: false });
      return;
    }
    if (
      location.page !== "playground" ||
      location.sessionId === undefined ||
      location.sessionId === selectedSessionId
    ) {
      return;
    }
    void loadSession(location.sessionId, { updatePath: false });
  }, [selectedSessionId, sessionsEnabled, loadSession, showSessionTraces]);

  useEffect(() => {
    function handlePopState() {
      const location = pageLocationFromLocation();
      setActivePage(location.page);
      setKnowledgeTab(location.knowledgeTab ?? defaultKnowledgeTab);
      setSelectedTraceId(location.traceId ?? "");
      setTraceSessionDetailId(location.traceSessionId);
      if (location.page === "tracing" && location.traceSessionId !== undefined) {
        void showSessionTraces(location.traceSessionId, { updatePath: false });
        return;
      }
      if (location.page !== "playground") {
        return;
      }
      if (location.sessionId === undefined) {
        startNewChat({ updatePath: false });
        return;
      }
      void loadSession(location.sessionId, { updatePath: false });
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [loadSession, showSessionTraces, startNewChat]);

  async function runPrompt(text: string) {
    const trimmed = text.trim();
    const promptAttachments = attachments;
    const agentId = selectedAgent?.id ?? selectedAgentId;
    if (
      (trimmed.length === 0 && promptAttachments.length === 0) ||
      agentId.length === 0 ||
      runState === "running" ||
      playgroundChat.status === "streaming"
    ) {
      return;
    }

    setRunState("running");
    setActivePage("playground");
    setError("");
    setPrompt("");
    setAttachments([]);
    transcriptStickToBottomRef.current = true;
    requestAnimationFrame(() => resizeTextarea(promptRef.current));
    const promptMessage =
      promptAttachments.length === 0
        ? trimmed
        : userMessageWithAttachments(trimmed, promptAttachments);
    setMessages((current) => [
      ...current,
      {
        entryId: nextTranscriptId(),
        kind: "message",
        role: "user",
        text: trimmed,
        ...(promptAttachments.length === 0
          ? {}
          : { attachments: transcriptAttachmentsForPrompt(promptAttachments) }),
      },
    ]);

    try {
      const sessionId =
        sessionsEnabled && selectedSessionId.length === 0
          ? (await createSession(titleFromText(trimmed))).id
          : selectedSessionId;
      const history = sessionsEnabled ? undefined : toHistory(messages);
      playgroundRunErrorRef.current = undefined;
      playgroundVisibleEventRef.current = Promise.resolve();
      playgroundRunRequestRef.current = {
        agentId,
        message: promptMessage,
        ...(sessionId.length === 0 ? {} : { sessionId }),
        ...(history === undefined ? {} : { history }),
        ...(selectedModelRef.length === 0 ? {} : { model: selectedModelRef }),
        stream: true,
        metadata: {
          source: "anvia-studio",
          ...(selectedModelRef.length === 0 ? {} : { studioModel: selectedModelRef }),
        },
      };

      await playgroundChat.send(trimmed);
      await playgroundVisibleEventRef.current;

      if (playgroundRunErrorRef.current === undefined) {
        await loadAllSessions();
        if (sessionId.length > 0) {
          setSelectedSessionId(sessionId);
          const [traceSummaries] = await Promise.all([
            loadSessionTraceSummaries(sessionId),
            loadSessionLogs(sessionId),
          ]);
          setMessages((current) => enrichTranscriptWithTraceIds(current, traceSummaries));
        }
        setStatus("Connected");
      }
    } catch (runError) {
      const message = errorMessage(runError);
      setError(message);
      appendAssistantError(message);
    } finally {
      playgroundRunRequestRef.current = undefined;
      playgroundChat.reset();
      setRunState("idle");
    }
  }

  async function runPipeline() {
    const pipelineId = selectedPipelineId || config?.pipelines[0]?.id || "";
    if (pipelineId.length === 0 || pipelineRunState === "running") {
      return;
    }

    let input: unknown;
    try {
      input = JSON.parse(pipelineRunInput);
    } catch {
      setError("Pipeline input must be valid JSON");
      return;
    }

    setPipelineRunState("running");
    setPipelineRunOutput("");
    setActivePipelineRunId("");
    setError("");
    try {
      const response = await fetch(`/pipelines/${encodeURIComponent(pipelineId)}/runs`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          input,
          stream: true,
          metadata: {
            source: "anvia-studio",
          },
        }),
      });

      if (!response.ok || response.body === null) {
        throw new Error(await responseErrorMessage(response, "Pipeline run failed"));
      }

      await consumePipelineRunStream(response.body);
      await Promise.all([loadPipelineLogs(pipelineId), loadPipelineRuns(pipelineId)]);
      setStatus("Connected");
    } catch (runError) {
      setError(errorMessage(runError));
    } finally {
      setPipelineRunState("idle");
    }
  }

  async function replayPipelineRun(runId: string) {
    const pipelineId = selectedPipelineId || config?.pipelines[0]?.id || "";
    if (pipelineId.length === 0 || runId.length === 0 || pipelineRunState === "running") {
      return;
    }

    setPipelineRunState("running");
    setPipelineRunOutput("");
    setActivePipelineRunId("");
    setError("");
    try {
      const response = await fetch(
        `/pipelines/${encodeURIComponent(pipelineId)}/runs/${encodeURIComponent(runId)}/replay`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            stream: true,
            metadata: {
              source: "anvia-studio",
            },
          }),
        },
      );

      if (!response.ok || response.body === null) {
        throw new Error(await responseErrorMessage(response, "Pipeline replay failed"));
      }

      await consumePipelineRunStream(response.body);
      await Promise.all([loadPipelineLogs(pipelineId), loadPipelineRuns(pipelineId)]);
      setStatus("Connected");
    } catch (runError) {
      setError(errorMessage(runError));
    } finally {
      setPipelineRunState("idle");
    }
  }

  async function runEvalSuite() {
    const evalId = selectedEvalId || config?.evals[0]?.id || "";
    if (evalId.length === 0 || evalRunState === "running") {
      return;
    }

    setEvalRunState("running");
    setEvalRunResult(undefined);
    setError("");
    try {
      const response = await fetch(`/evals/${encodeURIComponent(evalId)}/runs`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({}),
      });
      if (!response.ok) {
        throw new Error(await responseErrorMessage(response, "Eval run failed"));
      }
      setEvalRunResult((await response.json()) as StudioEvalRunResponse);
      setStatus("Connected");
    } catch (runError) {
      setError(errorMessage(runError));
    } finally {
      setEvalRunState("idle");
    }
  }

  async function consumePipelineRunStream(body: ReadableStream<Uint8Array>) {
    await readJsonl(body, async (event) => {
      if (isPipelineLogEvent(event)) {
        if (event.log.runId !== undefined) {
          setActivePipelineRunId((current) => current || event.log.runId || "");
        }
        appendPipelineLogEntry(event.log);
        await nextPaint();
        return;
      }
      if (isPipelineFinalEvent(event)) {
        setPipelineRunOutput(JSON.stringify(event.output, null, 2));
        await nextPaint();
        return;
      }
      if (isErrorStreamEvent(event)) {
        throw new Error(JSON.stringify(event.error));
      }
    });
  }

  function acceptStreamEvent(event: AgentRunStreamEvent): boolean {
    if (event.type === "text_delta") {
      appendAssistantText(event.delta);
      return true;
    }
    if (event.type === "reasoning_delta") {
      appendReasoningText(event.delta, event.id);
      return true;
    }
    if (event.type === "tool_call") {
      appendToolCall(
        event.toolCall.function.name,
        formatToolValue(event.toolCall.function.arguments),
        event.toolCall.callId ?? event.toolCall.id,
      );
      return true;
    }
    if (event.type === "tool_result") {
      appendToolResult({
        toolName: event.toolName,
        callId: event.toolCallId,
        args: event.args,
        result: event.result,
        ...(event.structuredResult === undefined
          ? {}
          : { structuredResult: event.structuredResult }),
      });
      return true;
    }
    if (event.type === "agent_tool_event") {
      appendAgentToolEvent(event);
      return true;
    }
    if (event.type === "tool_approval_request") {
      updateToolApproval(event.approval);
      return true;
    }
    if (event.type === "tool_approval_result") {
      updateToolApproval(event.approval);
      return true;
    }
    if (event.type === "tool_question_request") {
      updateToolQuestion(event.question);
      return true;
    }
    if (event.type === "tool_question_result") {
      updateToolQuestion(event.question);
      return true;
    }
    if (event.type === "session_log") {
      appendSessionLogEntry(event.log);
      return true;
    }
    if (event.type === "final" && event.trace?.traceId !== undefined) {
      assignAssistantTraceId(event.trace.traceId);
      return true;
    }
    if (event.type === "error") {
      const message = serializedStreamErrorText(event.error);
      playgroundRunErrorRef.current = event.error;
      setError(message);
      appendAssistantError(message);
      return true;
    }
    return false;
  }

  function appendSessionLogEntry(log: StudioSessionLogEntry) {
    setSessionLogs((current) => {
      if (current.some((item) => item.id === log.id)) {
        return current;
      }
      return [...current, log].sort((left, right) => left.sequence - right.sequence);
    });
  }

  function appendPipelineLogEntry(log: StudioPipelineLogEntry) {
    setPipelineLogs((current) => {
      if (current.some((item) => item.id === log.id)) {
        return current;
      }
      return [...current, log].sort((left, right) => left.sequence - right.sequence);
    });
  }

  function appendAssistantText(delta: string) {
    setMessages((current) => {
      const next = [...current];
      const last = next.at(-1);
      if (last?.kind === "message" && last.role === "assistant") {
        next[next.length - 1] = { ...last, text: `${last.text}${delta}` };
      } else {
        next.push({
          entryId: nextTranscriptId(),
          kind: "message",
          role: "assistant",
          text: delta,
        });
      }
      return next;
    });
  }

  function appendAssistantError(message: string) {
    setMessages((current) => [
      ...current,
      {
        entryId: nextTranscriptId(),
        kind: "message",
        role: "assistant",
        text: message,
        tone: "error",
      },
    ]);
  }

  function assignAssistantTraceId(traceId: string) {
    setMessages((current) => {
      const next = [...current];
      for (let index = next.length - 1; index >= 0; index -= 1) {
        const entry = next[index];
        if (entry?.kind === "message" && entry.role === "assistant") {
          next[index] = { ...entry, traceId };
          break;
        }
      }
      return next;
    });
  }

  function updateToolApproval(approval: ToolApprovalUpdate) {
    setMessages((current) => {
      const next = [...current];
      const matchedIndex = findMatchingToolIndexByCall(next, approval.toolName, approval.callId);
      if (matchedIndex < 0) {
        next.push({
          entryId: nextTranscriptId(),
          kind: "tool",
          toolName: approval.toolName,
          ...(approval.callId === undefined ? {} : { callId: approval.callId }),
          approval: {
            id: approval.id,
            status: approval.status,
            requestedAt: approval.requestedAt,
            ...(approval.resolvedAt === undefined ? {} : { resolvedAt: approval.resolvedAt }),
            ...(approval.reason === undefined ? {} : { reason: approval.reason }),
          },
        });
        return next;
      }

      const existing = next[matchedIndex];
      if (existing !== undefined && existing.kind === "tool") {
        next[matchedIndex] = {
          ...existing,
          approval: {
            id: approval.id,
            status: approval.status,
            requestedAt: approval.requestedAt,
            ...(approval.resolvedAt === undefined ? {} : { resolvedAt: approval.resolvedAt }),
            ...(approval.reason === undefined ? {} : { reason: approval.reason }),
          },
        };
      }
      return next;
    });
  }

  function updateToolQuestion(question: ToolQuestionUpdate) {
    setMessages((current) => {
      const next = [...current];
      const matchedIndex = findMatchingToolIndexByCall(next, question.toolName, question.callId);
      if (matchedIndex < 0) {
        next.push({
          entryId: nextTranscriptId(),
          kind: "tool",
          toolName: question.toolName,
          ...(question.callId === undefined ? {} : { callId: question.callId }),
          question: {
            id: question.id,
            status: question.status,
            requestedAt: question.requestedAt,
            ...(question.answeredAt === undefined ? {} : { answeredAt: question.answeredAt }),
            questions: question.questions,
            ...(question.answers === undefined ? {} : { answers: question.answers }),
          },
        });
        return next;
      }

      const existing = next[matchedIndex];
      if (existing !== undefined && existing.kind === "tool") {
        next[matchedIndex] = {
          ...existing,
          question: {
            id: question.id,
            status: question.status,
            requestedAt: question.requestedAt,
            ...(question.answeredAt === undefined ? {} : { answeredAt: question.answeredAt }),
            questions: question.questions,
            ...(question.answers === undefined ? {} : { answers: question.answers }),
          },
        };
      }
      return next;
    });
  }

  async function decideToolApproval(approvalId: string, approved: boolean) {
    if (decidingApprovals.has(approvalId)) {
      return;
    }

    setDecidingApprovals((current) => new Set(current).add(approvalId));
    setError("");
    try {
      const response = await fetch(`/approvals/${encodeURIComponent(approvalId)}/decision`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ approved }),
      });
      if (!response.ok) {
        throw new Error(`Approval decision failed with HTTP ${response.status}`);
      }
      const approval = await response.json();
      updateToolApproval(approval);
    } catch (decisionError) {
      setError(errorMessage(decisionError));
    } finally {
      setDecidingApprovals((current) => {
        const next = new Set(current);
        next.delete(approvalId);
        return next;
      });
    }
  }

  async function answerToolQuestion(
    questionId: string,
    answers: Array<{ questionId: string; answer: string; choice?: string; custom?: boolean }>,
  ) {
    if (answeringQuestions.has(questionId)) {
      return;
    }

    setAnsweringQuestions((current) => new Set(current).add(questionId));
    setError("");
    try {
      const response = await fetch(`/questions/${encodeURIComponent(questionId)}/answer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ answers }),
      });
      if (!response.ok) {
        throw new Error(`Question answer failed with HTTP ${response.status}`);
      }
      const question = await response.json();
      updateToolQuestion(question);
    } catch (answerError) {
      setError(errorMessage(answerError));
    } finally {
      setAnsweringQuestions((current) => {
        const next = new Set(current);
        next.delete(questionId);
        return next;
      });
    }
  }

  function appendReasoningText(delta: string, reasoningId: string | undefined) {
    setMessages((current) => {
      const next = [...current];
      const last = next.at(-1);
      if (last?.kind === "reasoning" && (last.reasoningId ?? "") === (reasoningId ?? "")) {
        next[next.length - 1] = { ...last, text: `${last.text}${delta}` };
      } else {
        next.push({
          entryId: nextTranscriptId(),
          kind: "reasoning",
          ...(reasoningId === undefined ? {} : { reasoningId }),
          text: delta,
        });
      }
      return next;
    });
  }

  function appendToolCall(toolName: string, args: string, callId: string | undefined) {
    setMessages((current) => [
      ...current,
      {
        entryId: nextTranscriptId(),
        kind: "tool",
        toolName,
        ...(callId === undefined ? {} : { callId }),
        ...(args.length === 0 ? {} : { args }),
      },
    ]);
  }

  function appendToolResult(props: {
    toolName: string;
    callId: string | undefined;
    args: string;
    result: string;
    structuredResult?: ToolResultContent[];
  }) {
    setMessages((current) => {
      const next = [...current];
      const matchedIndex = findMatchingToolIndex(next, props.toolName, props.callId);
      if (matchedIndex >= 0) {
        const existing = next[matchedIndex];
        if (existing !== undefined && existing.kind === "tool") {
          next[matchedIndex] = {
            ...existing,
            args: existing.args ?? props.args,
            result: props.result,
            ...(props.structuredResult === undefined
              ? {}
              : { structuredResult: props.structuredResult }),
          };
          return next;
        }
      }

      next.push({
        entryId: nextTranscriptId(),
        kind: "tool",
        toolName: props.toolName,
        ...(props.callId === undefined ? {} : { callId: props.callId }),
        args: props.args,
        result: props.result,
        ...(props.structuredResult === undefined
          ? {}
          : { structuredResult: props.structuredResult }),
      });
      return next;
    });
  }

  function appendAgentToolEvent(event: Extract<AgentRunStreamEvent, { type: "agent_tool_event" }>) {
    const childEvent = childAgentTranscriptEvent(event);
    if (childEvent === undefined) {
      return;
    }
    setMessages((current) => {
      const next = [...current];
      const matchedIndex = findMatchingToolIndex(next, event.toolName, event.toolCallId);
      if (matchedIndex < 0) {
        next.push({
          entryId: nextTranscriptId(),
          kind: "tool",
          toolName: event.toolName,
          ...(event.toolCallId === undefined ? {} : { callId: event.toolCallId }),
          childEvents: [childEvent],
        });
        return next;
      }

      const existing = next[matchedIndex];
      if (existing === undefined || existing.kind !== "tool") {
        return next;
      }
      const childEvents = [...(existing.childEvents ?? [])];
      appendChildAgentTranscriptEvent(childEvents, childEvent);
      next[matchedIndex] = {
        ...existing,
        childEvents,
      };
      return next;
    });
  }

  function childAgentTranscriptEvent(
    event: Extract<AgentRunStreamEvent, { type: "agent_tool_event" }>,
  ): StudioTranscriptChildAgentEvent | undefined {
    const child = event.event;
    if (child.type === "text_delta") {
      return {
        kind: "message",
        agentId: event.agentId,
        ...(event.agentName === undefined ? {} : { agentName: event.agentName }),
        text: child.delta,
      };
    }
    if (child.type === "reasoning_delta") {
      return {
        kind: "reasoning",
        agentId: event.agentId,
        ...(event.agentName === undefined ? {} : { agentName: event.agentName }),
        ...(child.id === undefined ? {} : { reasoningId: child.id }),
        text: child.delta,
      };
    }
    if (child.type === "tool_call") {
      return {
        kind: "tool",
        agentId: event.agentId,
        ...(event.agentName === undefined ? {} : { agentName: event.agentName }),
        toolName: child.toolCall.function.name,
        ...(child.toolCall.callId === undefined && child.toolCall.id === undefined
          ? {}
          : { callId: child.toolCall.callId ?? child.toolCall.id }),
        args: formatToolValue(child.toolCall.function.arguments),
      };
    }
    if (child.type === "tool_result") {
      return {
        kind: "tool",
        agentId: event.agentId,
        ...(event.agentName === undefined ? {} : { agentName: event.agentName }),
        toolName: child.toolName,
        ...(child.toolCallId === undefined ? {} : { callId: child.toolCallId }),
        args: child.args,
        result: child.result,
        ...(child.structuredResult === undefined
          ? {}
          : { structuredResult: child.structuredResult }),
      };
    }
    if (child.type === "error") {
      return {
        kind: "message",
        agentId: event.agentId,
        ...(event.agentName === undefined ? {} : { agentName: event.agentName }),
        text: `Error: ${errorMessage(child.error)}`,
      };
    }
    return undefined;
  }

  function appendChildAgentTranscriptEvent(
    childEvents: StudioTranscriptChildAgentEvent[],
    childEvent: StudioTranscriptChildAgentEvent,
  ) {
    if (childEvent.kind === "message") {
      const last = childEvents.at(-1);
      if (last?.kind === "message" && last.agentId === childEvent.agentId) {
        childEvents[childEvents.length - 1] = { ...last, text: `${last.text}${childEvent.text}` };
      } else {
        childEvents.push(childEvent);
      }
      return;
    }
    if (childEvent.kind === "reasoning") {
      const last = childEvents.at(-1);
      if (
        last?.kind === "reasoning" &&
        last.agentId === childEvent.agentId &&
        (last.reasoningId ?? "") === (childEvent.reasoningId ?? "")
      ) {
        childEvents[childEvents.length - 1] = { ...last, text: `${last.text}${childEvent.text}` };
      } else {
        childEvents.push(childEvent);
      }
      return;
    }
    const matchedIndex = findChildAgentToolEventIndex(childEvents, childEvent);
    if (matchedIndex < 0) {
      childEvents.push(childEvent);
      return;
    }
    const matched = childEvents[matchedIndex];
    if (matched?.kind === "tool") {
      childEvents[matchedIndex] = {
        ...matched,
        ...(matched.args !== undefined || childEvent.args === undefined
          ? {}
          : { args: childEvent.args }),
        ...(childEvent.result === undefined ? {} : { result: childEvent.result }),
      };
    }
  }

  function findChildAgentToolEventIndex(
    childEvents: StudioTranscriptChildAgentEvent[],
    event: Extract<StudioTranscriptChildAgentEvent, { kind: "tool" }>,
  ): number {
    for (let index = childEvents.length - 1; index >= 0; index -= 1) {
      const childEvent = childEvents[index];
      if (
        childEvent?.kind !== "tool" ||
        childEvent.agentId !== event.agentId ||
        childEvent.toolName !== event.toolName ||
        childEvent.result !== undefined
      ) {
        continue;
      }
      if (event.callId === undefined || childEvent.callId === event.callId) {
        return index;
      }
    }
    return -1;
  }

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

  function navigatePage(page: ActivePage) {
    if (!isActivePageEnabled(page, pageAvailability)) {
      return;
    }

    setActivePage(page);
    if (page === "pipelines") {
      const pipelineId = selectedPipelineId || pipelines[0]?.id || "";
      if (pipelineId.length > 0) {
        setSelectedPipelineId(pipelineId);
        void loadPipeline(pipelineId);
      }
    }
    if (page === "tracing") {
      setSelectedTraceId("");
      setTraceSessionDetailId(undefined);
      updatePagePath("tracing");
      return;
    }
    if (page === "knowledge") {
      setSelectedTraceId("");
      setTraceSessionDetailId(undefined);
      updateKnowledgePath(knowledgeTab);
      return;
    }
    setSelectedTraceId("");
    setTraceSessionDetailId(undefined);
    if (page === "playground" && selectedSessionId.length > 0) {
      updateSessionPath(selectedSessionId);
      return;
    }
    updatePagePath(page);
  }

  function navigateKnowledgeTab(tab: KnowledgeTab) {
    setActivePage("knowledge");
    setKnowledgeTab(tab);
    setSelectedTraceId("");
    setTraceSessionDetailId(undefined);
    updateKnowledgePath(tab);
  }

  useEffect(() => {
    if (config === undefined || hasAgents || activePage !== "playground") {
      return;
    }

    const nextPage = fallbackActivePage("playground", pageAvailability);

    resetTranscriptSequence();
    setSelectedSessionId("");
    setSessionLogs([]);
    setMessages([]);
    setPrompt("");
    setAttachments([]);
    setActivePage(nextPage);
    updatePagePath(nextPage);

    if (nextPage === "pipelines") {
      const pipelineId = selectedPipelineId || pipelines[0]?.id || "";
      if (pipelineId.length > 0) {
        setSelectedPipelineId(pipelineId);
        void loadPipeline(pipelineId);
      }
    }
    if (nextPage === "evals") {
      setSelectedEvalId(selectedEvalId || config.evals[0]?.id || "");
    }
  }, [
    activePage,
    config,
    hasAgents,
    loadPipeline,
    pageAvailability,
    pipelines,
    selectedEvalId,
    selectedPipelineId,
  ]);

  function selectTrace(traceId: string) {
    setActivePage("tracing");
    setSelectedTraceId(traceId);
    setTraceSessionDetailId(undefined);
    if (traceId.length === 0) {
      updatePagePath("tracing");
      return;
    }
    updateTracePath(traceId);
  }

  return (
    <div className="grid h-[100dvh] min-h-0 overflow-hidden bg-background text-foreground lg:grid-cols-[228px_minmax(0,1fr)]">
      <aside className="flex h-[100dvh] min-h-0 flex-col overflow-hidden bg-sidebar text-sidebar-foreground">
        <div className="flex h-15 items-center px-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <img className="h-7 w-7 shrink-0 object-contain" src={logoSrc} alt="" />
            <span className="min-w-0 truncate">
              <span className="anvia-wordmark text-[1.08rem] font-semibold tracking-normal text-sidebar-foreground">
                Anvia Studio
              </span>
            </span>
          </div>
        </div>
        <nav className="grid gap-0.5 px-3 py-3" aria-label="Main">
          <div className="px-2.5 pb-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Workspace
          </div>
          <NavButton
            active={activePage === "playground"}
            icon="message"
            label="Chat"
            disabled={!hasAgents}
            onClick={() => navigatePage("playground")}
          />
          <NavButton
            active={activePage === "pipelines"}
            icon="workflow"
            label="Pipelines"
            disabled={!pipelinesEnabled}
            onClick={() => navigatePage("pipelines")}
          />
          <NavButton
            active={activePage === "evals"}
            icon="gauge"
            label="Evals"
            disabled={!evalsEnabled}
            onClick={() => navigatePage("evals")}
          />
          <NavButton
            active={activePage === "sessions"}
            icon="list"
            label="Sessions"
            disabled={!sessionsEnabled}
            onClick={() => navigatePage("sessions")}
          />
          <NavButton
            active={activePage === "tracing"}
            icon="activity"
            label="Traces"
            disabled={!tracesEnabled}
            onClick={() => navigatePage("tracing")}
          />
        </nav>
        <nav className="grid gap-0.5 px-3 py-3" aria-label="Studio">
          <div className="px-2.5 pb-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Inspect
          </div>
          <NavButton
            active={activePage === "agents"}
            icon="bot"
            label="Studio"
            onClick={() => navigatePage("agents")}
          />
          <NavButton
            active={activePage === "tools"}
            icon="wrench"
            label="Tools"
            disabled={!toolsEnabled}
            onClick={() => navigatePage("tools")}
          />
          <NavButton
            active={activePage === "mcps"}
            icon="plug"
            label="MCPs"
            disabled={!mcpsEnabled}
            onClick={() => navigatePage("mcps")}
          />
          <NavButton
            active={activePage === "knowledge"}
            icon="database"
            label="Knowledge"
            disabled={!knowledgeEnabled}
            onClick={() => navigatePage("knowledge")}
          />
          <NavButton
            active={activePage === "memory"}
            icon="database"
            label="Memory"
            disabled={!memoryEnabled}
            onClick={() => navigatePage("memory")}
          />
          <NavButton
            active={activePage === "status"}
            icon="gauge"
            label="Status"
            disabled={!statusEnabled}
            onClick={() => navigatePage("status")}
          />
        </nav>
        <nav className="grid min-h-0 gap-0.5 overflow-auto px-3 py-3" aria-label="Recent sessions">
          <div className="px-2.5 pb-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Recent
          </div>
          {allSessions.slice(0, 8).map((session) => (
            <div
              className={cn(
                "group grid min-h-7 min-w-0 grid-cols-[minmax(0,1fr)_36px] items-center gap-1 rounded-lg pr-1 transition duration-200 hover:bg-sidebar-accent/80 focus-within:bg-sidebar-accent/80",
                session.id === selectedSessionId && "bg-sidebar-accent",
              )}
              key={session.id}
            >
              <Button
                className={cn(
                  "grid h-auto min-h-7 min-w-0 justify-start rounded-lg border-0 bg-transparent px-2.5 py-0.5 text-left text-sidebar-foreground/72 shadow-none hover:bg-transparent hover:text-sidebar-foreground",
                  session.id === selectedSessionId && "text-sidebar-accent-foreground",
                )}
                type="button"
                variant="ghost"
                onClick={() => void loadSession(session.id)}
              >
                <span className="min-w-0 truncate text-xs font-medium">
                  {session.title ?? "Untitled chat"}
                </span>
              </Button>
              <div className="relative grid h-7 min-w-0 place-items-end">
                <time className="grid h-6 min-w-6 place-items-center self-center justify-self-end rounded-lg px-1.5 font-mono text-[10px] font-medium tabular-nums text-muted-foreground group-hover:opacity-0 group-focus-within:opacity-0">
                  {formatRelativeTime(session.updatedAt)}
                </time>
                <Button
                  aria-label={`Delete ${session.title ?? "Untitled chat"}`}
                  className="absolute right-0 top-1/2 hidden h-6 min-h-6 w-6 -translate-y-1/2 border-0 bg-transparent p-0 text-muted-foreground opacity-70 shadow-none hover:bg-transparent hover:text-destructive hover:opacity-100 group-hover:grid group-focus-within:grid [&_svg]:h-3.5 [&_svg]:w-3.5"
                  size="icon"
                  type="button"
                  variant="ghost"
                  disabled={runState === "running"}
                  onClick={() => setDeleteCandidate(session)}
                >
                  <Archive aria-hidden="true" />
                </Button>
              </div>
            </div>
          ))}
        </nav>
        <div className="mt-auto px-3 py-3">
          <nav className="grid gap-1" aria-label="Anvia links">
            <SidebarLink href="https://anvia.dev/docs" label="Anvia Docs" />
            <SidebarLink href="https://anvia.dev" label="Anvia Web" />
          </nav>
          <span className="sr-only" aria-live="polite">
            {status}
          </span>
        </div>
      </aside>

      <main className="grid h-[100dvh] min-w-0 grid-rows-[52px_minmax(0,1fr)] overflow-hidden bg-background/80">
        <header className="grid min-h-13 bg-background/88 backdrop-blur">
          <div className="grid min-h-13 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-0 pl-0 pr-6">
            <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
              <span className="text-primary">
                {activePage === "playground" ? "Agents" : "Studio"}
              </span>
              <span className="text-muted-foreground">/</span>
              <span className="truncate">
                {selectedAgent?.name ?? selectedAgent?.id ?? "Agent"}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <Button
                aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
                className="h-8 min-h-8 w-8 border-transparent bg-transparent p-0 text-muted-foreground hover:bg-muted hover:text-foreground"
                title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
                type="button"
                variant="secondary"
                size="icon"
                onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
              >
                {theme === "dark" ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
              </Button>
              <Button
                className="h-8 min-h-8 border-transparent bg-transparent px-3 font-mono text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                type="button"
                variant="secondary"
                disabled={!sessionsEnabled}
                onClick={() => navigatePage("sessions")}
              >
                Sessions
              </Button>
              <Button
                className="h-8 min-h-8 gap-1.5 rounded-lg border-0 bg-primary px-3 font-mono text-xs text-primary-foreground hover:bg-primary/90"
                type="button"
                onClick={() => startNewChat()}
              >
                <Plus aria-hidden="true" />
                New session
              </Button>
            </div>
          </div>
        </header>

        {activePage === "playground" ? (
          <section className="grid h-full min-h-0 min-w-0 max-h-full max-w-full grid-cols-[minmax(0,1fr)_minmax(0,460px)] overflow-hidden bg-background/45 max-xl:grid-cols-1">
            <div className="grid min-h-0 min-w-0 pb-6 pr-6">
              <div className="grid h-full min-h-0 min-w-0 grid-rows-[minmax(0,1fr)_auto] overflow-hidden rounded-lg border border-border/80 bg-card/70 p-2 shadow-sm">
                <section
                  className="min-h-0 overflow-y-auto overflow-x-hidden px-4 py-4 [scrollbar-gutter:stable]"
                  ref={transcriptScrollerRef}
                  onScroll={updateTranscriptStickiness}
                >
                  <div className="mx-auto grid min-h-full w-full max-w-235 content-start items-start gap-6 pb-8">
                    {!hasMessages ? (
                      <div className="grid min-h-96 place-items-center text-sm font-medium text-muted-foreground">
                        <div className="grid max-w-xl gap-4 text-center">
                          <div className="mx-auto h-px w-28 bg-primary/45" />
                          <h1 className="m-0 text-4xl font-semibold leading-tight text-foreground text-balance">
                            What should this agent work on?
                          </h1>
                          <p className="m-0 text-base leading-7 text-muted-foreground text-pretty">
                            Choose a prompt below or write a task. Studio will stream the response,
                            tool calls, approvals, and trace data here.
                          </p>
                        </div>
                      </div>
                    ) : null}
                    <Suspense fallback={null}>
                      {messages.map((message) => (
                        <TranscriptItem
                          key={message.entryId}
                          entry={message}
                          decidingApprovals={decidingApprovals}
                          answeringQuestions={answeringQuestions}
                          onApprovalDecision={(approvalId, approved) =>
                            void decideToolApproval(approvalId, approved)
                          }
                          onQuestionAnswer={(questionId, answers) =>
                            void answerToolQuestion(questionId, answers)
                          }
                          onOpenTrace={selectTrace}
                        />
                      ))}
                    </Suspense>
                  </div>
                </section>
                <form
                  className="grid gap-3 bg-gradient-to-t from-card via-card/95 to-card/0 px-4 pb-4 pt-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void runPrompt(prompt);
                  }}
                >
                  {hasMessages || selectedAgentQuickPrompts.length === 0 ? null : (
                    <div className="mx-auto grid w-full max-w-235 grid-cols-3 gap-2 max-md:grid-cols-1">
                      {selectedAgentQuickPrompts.map((quickPrompt) => (
                        <Button
                          className="h-auto min-h-16 justify-start whitespace-normal rounded-lg border border-border/80 bg-card/85 px-3 py-2.5 text-left text-sm font-medium leading-5 text-foreground shadow-sm hover:border-primary/45 hover:bg-primary/10 hover:text-primary"
                          type="button"
                          variant="ghost"
                          disabled={runState === "running" || selectedAgentId.length === 0}
                          onClick={() => void runPrompt(quickPrompt)}
                          key={quickPrompt}
                        >
                          <span className="min-w-0 whitespace-normal wrap-break-words">
                            {quickPrompt}
                          </span>
                        </Button>
                      ))}
                    </div>
                  )}
                  <div className="mx-auto grid w-full max-w-235 gap-2 rounded-lg border border-border/80 bg-card/95 p-2.5 shadow-xl shadow-black/35 backdrop-blur focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/25">
                    <Textarea
                      className="min-h-16 min-w-0 resize-none rounded-lg border-0 bg-transparent px-3 py-3 text-[15px] leading-7 text-foreground shadow-none outline-none ring-0 placeholder:text-muted-foreground/70 focus:border-transparent focus:ring-0"
                      ref={promptRef}
                      rows={1}
                      value={prompt}
                      onChange={updatePrompt}
                      onKeyDown={handlePromptKeyDown}
                      placeholder="Ask anything..."
                    />
                    {attachments.length === 0 ? null : (
                      <div className="flex min-w-0 flex-wrap gap-1.5 px-2">
                        {attachments.map((attachment) => (
                          <span
                            className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-border/80 bg-muted/55 px-2 py-1 font-mono text-[11px] font-medium text-muted-foreground"
                            key={attachment.id}
                          >
                            <span className="min-w-0 truncate">
                              {attachment.kind === "image" ? "Image" : "Doc"} / {attachment.name}
                            </span>
                            <Button
                              aria-label={`Remove ${attachment.name}`}
                              className="h-5 min-h-5 w-5 rounded-md border-0 bg-transparent p-0 text-muted-foreground shadow-none hover:bg-accent hover:text-foreground [&_svg]:h-3 [&_svg]:w-3"
                              size="icon"
                              type="button"
                              variant="ghost"
                              onClick={() => removePromptAttachment(attachment.id)}
                            >
                              <X aria-hidden="true" />
                            </Button>
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="flex min-w-0 items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <input
                          ref={attachmentInputRef}
                          className="hidden"
                          type="file"
                          multiple
                          accept={supportedAttachmentTypes}
                          onChange={(event) => void addPromptAttachments(event)}
                        />
                        <Button
                          aria-label="Attach image or document"
                          className="h-8 min-h-8 w-8 border-0 bg-transparent p-0 text-muted-foreground shadow-none hover:bg-accent hover:text-accent-foreground"
                          size="icon"
                          type="button"
                          variant="ghost"
                          disabled={runState === "running"}
                          onClick={() => attachmentInputRef.current?.click()}
                        >
                          <Paperclip aria-hidden="true" />
                        </Button>
                      </div>
                      <div className="flex min-w-0 items-center gap-2">
                        {selectedAgentModels.length === 0 ? null : (
                          <Select
                            value={selectedModelRef}
                            onValueChange={setSelectedModelRef}
                            disabled={runState === "running"}
                          >
                            <SelectTrigger
                              aria-label="Select model"
                              className="flex h-8 min-h-8 w-auto max-w-44 gap-2 border-0 bg-transparent px-2 py-1 font-mono text-xs font-medium text-muted-foreground shadow-none hover:bg-accent hover:text-accent-foreground sm:max-w-72"
                            >
                              <SelectValue placeholder="Model" />
                            </SelectTrigger>
                            <SelectContent align="end">
                              {selectedAgentModels.map((model) => (
                                <SelectItem value={model.ref} key={model.ref}>
                                  {modelSelectLabel(model)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                        {agents.length > 1 ? (
                          <Select
                            value={selectedAgent?.id ?? selectedAgentId}
                            onValueChange={selectPlaygroundAgent}
                            disabled={runState === "running"}
                          >
                            <SelectTrigger
                              aria-label="Select agent"
                              className="hidden h-8 min-h-8 w-auto max-w-64 gap-2 border-0 bg-transparent px-2 py-1 font-mono text-xs font-medium text-muted-foreground shadow-none hover:bg-accent hover:text-accent-foreground sm:flex"
                            >
                              <SelectValue placeholder="Agent" />
                            </SelectTrigger>
                            <SelectContent align="end">
                              {agents.map((agent) => (
                                <SelectItem value={agent.id} key={agent.id}>
                                  {agent.name ?? agent.id}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <span className="hidden max-w-60 truncate rounded-lg px-2 py-1 font-mono text-xs font-medium text-muted-foreground sm:block">
                            {selectedAgent?.name ?? selectedAgent?.id ?? "Agent"}
                          </span>
                        )}
                        <Button
                          aria-label={runState === "running" ? "Running" : "Send message"}
                          className="h-9 min-h-9 w-9 rounded-lg border-primary bg-primary text-primary-foreground hover:bg-primary/90"
                          size="icon"
                          type="submit"
                          disabled={runState === "running" || selectedAgentId.length === 0}
                        >
                          <ArrowUp />
                        </Button>
                      </div>
                    </div>
                  </div>
                </form>
              </div>
            </div>
            <SessionLogsPanel
              logs={sessionLogs}
              selectedSessionId={selectedSessionId}
              loading={sessionLogLoadState === "loading"}
            />
          </section>
        ) : null}

        {activePage === "tracing" ? (
          <Suspense fallback={<PageLoading />}>
            <TraceBrowser
              agents={agents}
              traces={traces}
              tracesEnabled={tracesEnabled}
              traceLoadState={traceLoadState}
              selectedTraceId={selectedTraceId}
              traceSessionDetailId={traceSessionDetailId}
              onRefresh={() => void loadTraces()}
              onSelectTrace={selectTrace}
              onShowSessionTraces={(sessionId) => void showSessionTraces(sessionId)}
            />
          </Suspense>
        ) : null}

        {activePage === "sessions" ? (
          <Suspense fallback={<PageLoading />}>
            <SessionsPage
              agents={agents}
              sessions={allSessions}
              sessionsEnabled={sessionsEnabled}
              sessionLoadState={sessionLoadState}
              selectedSessionId={selectedSessionId}
              onOpenSession={(sessionId) => void loadSession(sessionId)}
              onViewSessionTracing={(sessionId) => void showSessionTraces(sessionId)}
              onDeleteSession={setDeleteCandidate}
            />
          </Suspense>
        ) : null}

        {activePage === "agents" ? (
          <Suspense fallback={<PageLoading />}>
            <AgentsPage agents={agents} selectedAgentId={selectedAgentId} />
          </Suspense>
        ) : null}

        {activePage === "tools" ? (
          <Suspense fallback={<PageLoading />}>
            <ToolsPage
              agents={agents}
              selectedAgentId={toolsAgentId || selectedAgent?.id || selectedAgentId}
              summary={tools}
              enabled={toolsEnabled}
              loading={toolsLoadState === "loading"}
              onSelectAgent={(agentId) => {
                setToolsAgentId(agentId);
                void loadTools(agentId);
              }}
            />
          </Suspense>
        ) : null}

        {activePage === "pipelines" ? (
          <Suspense fallback={<PageLoading />}>
            <PipelinesPage
              pipelines={pipelines}
              selectedPipelineId={selectedPipelineId}
              detail={pipelineDetail}
              logs={pipelineLogs}
              activeRunId={activePipelineRunId}
              runs={pipelineRuns}
              enabled={pipelinesEnabled}
              detailLoading={pipelineDetailLoadState === "loading"}
              logsLoading={pipelineLogLoadState === "loading"}
              runsLoading={pipelineRunLoadState === "loading"}
              runState={pipelineRunState}
              runInput={pipelineRunInput}
              runOutput={pipelineRunOutput}
              theme={theme}
              onSelectPipeline={(pipelineId) => {
                setSelectedPipelineId(pipelineId);
                setPipelineRunOutput("");
                setActivePipelineRunId("");
                void loadPipeline(pipelineId);
              }}
              onRunInputChange={setPipelineRunInput}
              onRun={() => void runPipeline()}
              onReplayRun={(runId) => void replayPipelineRun(runId)}
            />
          </Suspense>
        ) : null}

        {activePage === "evals" ? (
          <Suspense fallback={<PageLoading />}>
            <EvalsPage
              evals={evals}
              selectedEvalId={selectedEvalId}
              enabled={evalsEnabled}
              runState={evalRunState}
              result={evalRunResult}
              onSelectEval={(evalId) => {
                setSelectedEvalId(evalId);
                setEvalRunResult(undefined);
              }}
              onRun={() => void runEvalSuite()}
            />
          </Suspense>
        ) : null}

        {activePage === "mcps" ? (
          <Suspense fallback={<PageLoading />}>
            <McpsPage
              agents={agents}
              selectedAgentId={mcpsAgentId || selectedAgent?.id || selectedAgentId}
              summary={mcps}
              enabled={mcpsEnabled}
              loading={mcpsLoadState === "loading"}
              onSelectAgent={(agentId) => {
                setMcpsAgentId(agentId);
                void loadMcps(agentId);
              }}
            />
          </Suspense>
        ) : null}

        {activePage === "knowledge" ? (
          <Suspense fallback={<PageLoading />}>
            <KnowledgePage
              activeTab={knowledgeTab}
              enabled={knowledgeEnabled}
              summary={knowledge}
              loading={knowledgeLoadState === "loading"}
              onOpenTrace={selectTrace}
              onRefresh={() => void loadKnowledge()}
              onSelectTab={navigateKnowledgeTab}
            />
          </Suspense>
        ) : null}

        {activePage === "memory" ? (
          <Suspense fallback={<PageLoading />}>
            <MemoryPage agents={agents} enabled={memoryEnabled} />
          </Suspense>
        ) : null}

        {activePage === "status" ? (
          <Suspense fallback={<PageLoading />}>
            <StatusPage enabled={statusEnabled} />
          </Suspense>
        ) : null}
      </main>
      <Suspense fallback={null}>
        <DeleteSessionDialog
          session={deleteCandidate}
          onOpenChange={(open) => {
            if (!open) {
              setDeleteCandidate(undefined);
            }
          }}
          onConfirm={(session) => void deleteSession(session)}
        />
      </Suspense>
    </div>
  );
}

function SidebarLink(props: { href: string; label: string }) {
  return (
    <a
      className="flex h-8 min-h-8 items-center justify-between rounded-lg px-2 font-mono text-[11px] font-semibold text-sidebar-foreground/62 transition duration-200 hover:bg-sidebar-accent hover:text-sidebar-foreground"
      href={props.href}
      target="_blank"
      rel="noreferrer"
    >
      <span>{props.label}</span>
      <ArrowSquareOut aria-hidden="true" className="h-3 w-3 text-muted-foreground" />
    </a>
  );
}

function PageLoading() {
  return (
    <section className="grid h-full min-h-0 place-items-center bg-background/45 text-sm font-medium text-muted-foreground">
      Loading
    </section>
  );
}

function isPipelineLogEvent(event: unknown): event is {
  type: "pipeline_log";
  log: StudioPipelineLogEntry;
} {
  return isRecord(event) && event.type === "pipeline_log" && isRecord(event.log);
}

function isPipelineFinalEvent(event: unknown): event is {
  type: "pipeline_final";
  output: unknown;
} {
  return isRecord(event) && event.type === "pipeline_final" && "output" in event;
}

function isErrorStreamEvent(event: unknown): event is {
  type: "error";
  error: unknown;
} {
  return isRecord(event) && event.type === "error";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function enrichTranscriptWithTraceIds(
  transcript: TranscriptEntry[],
  traceSummaries: StudioTraceSummary[],
): TranscriptEntry[] {
  const sortedTraceIds = [...traceSummaries]
    .sort((left, right) => Date.parse(left.startedAt) - Date.parse(right.startedAt))
    .map((trace) => trace.id);
  let traceIndex = 0;
  let pendingAssistantIndex: number | undefined;
  const next = transcript.map((entry) =>
    entry.kind === "message" && entry.role === "assistant" ? withoutTraceId(entry) : entry,
  );

  function assignPendingTraceId() {
    if (pendingAssistantIndex === undefined) {
      return;
    }
    const traceId = sortedTraceIds[traceIndex];
    traceIndex += 1;
    if (traceId !== undefined) {
      const entry = next[pendingAssistantIndex];
      next[pendingAssistantIndex] = { ...entry, traceId } as TranscriptEntry;
    }
    pendingAssistantIndex = undefined;
  }

  for (const [index, entry] of next.entries()) {
    if (entry.kind === "message" && entry.role === "user") {
      assignPendingTraceId();
      continue;
    }
    if (entry.kind === "message" && entry.role === "assistant") {
      pendingAssistantIndex = index;
    }
  }
  assignPendingTraceId();

  return next;
}

function withoutTraceId(entry: Extract<TranscriptEntry, { kind: "message" }>): TranscriptEntry {
  const { traceId: _traceId, ...rest } = entry;
  return rest;
}

function sessionModelRef(session: StudioSession): string {
  const value = session.metadata?.[studioModelMetadataKey];
  return typeof value === "string" ? value : "";
}

function modelRefAvailable(models: StudioModelSummary[], ref: string): boolean {
  return ref.length > 0 && models.some((model) => model.ref === ref);
}

function modelSelectLabel(model: StudioModelSummary): string {
  const provider = model.providerName ?? model.providerId;
  const name = model.name ?? model.id;
  const modalities = model.modalities?.input
    .filter((modality) => modality !== "text")
    .map((modality) => modality.slice(0, 3))
    .join("/");
  return modalities === undefined || modalities.length === 0
    ? `${provider} / ${name}`
    : `${provider} / ${name} (${modalities})`;
}

async function fileToAttachment(file: File): Promise<PromptAttachment> {
  const mediaType = file.type || mediaTypeFromName(file.name);
  const kind = mediaType.startsWith("image/") ? "image" : "document";
  if (!isSupportedAttachment(mediaType, file.name)) {
    throw new Error(`Unsupported attachment type: ${file.name}`);
  }
  return {
    id: globalThis.crypto.randomUUID(),
    name: file.name,
    mediaType,
    kind,
    data: await fileToBase64(file),
    size: file.size,
  };
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error(`Failed to read ${file.name}`));
    reader.onload = () => {
      const value = reader.result;
      if (typeof value !== "string") {
        reject(new Error(`Failed to read ${file.name}`));
        return;
      }
      resolve(value.slice(value.indexOf(",") + 1));
    };
    reader.readAsDataURL(file);
  });
}

function userMessageWithAttachments(text: string, attachments: PromptAttachment[]): Message {
  const content: UserContent[] = [];
  if (text.length > 0) {
    content.push({ type: "text", text });
  }
  for (const attachment of attachments) {
    if (attachment.kind === "image") {
      content.push({
        type: "image",
        source: {
          type: "base64",
          data: attachment.data,
          mediaType: attachment.mediaType,
        },
      });
      continue;
    }
    content.push({
      type: "document",
      source: {
        type: "base64",
        data: attachment.data,
        mediaType: attachment.mediaType,
        filename: attachment.name,
      },
    });
  }
  return { role: "user", content };
}

function transcriptAttachmentsForPrompt(
  attachments: PromptAttachment[],
): NonNullable<Extract<TranscriptEntry, { kind: "message" }>["attachments"]> {
  return attachments.map((attachment) => ({
    kind: attachment.kind,
    name: attachment.name,
    mediaType: attachment.mediaType,
    data: attachment.data,
  }));
}

function isSupportedAttachment(mediaType: string, name: string): boolean {
  return (
    mediaType.startsWith("image/") ||
    mediaType === "application/pdf" ||
    mediaType.startsWith("text/") ||
    ["application/json", "text/markdown", "text/csv"].includes(mediaType) ||
    /\.(md|csv|json|txt)$/i.test(name)
  );
}

function mediaTypeFromName(name: string): string {
  if (/\.pdf$/i.test(name)) return "application/pdf";
  if (/\.md$/i.test(name)) return "text/markdown";
  if (/\.csv$/i.test(name)) return "text/csv";
  if (/\.json$/i.test(name)) return "application/json";
  return "text/plain";
}
