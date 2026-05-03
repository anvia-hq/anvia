import { ArrowUp, Plus, Trash2 } from "lucide-react";
import {
  type ChangeEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type {
  AgentRunStreamEvent,
  StudioConfig,
  StudioKnowledgeSummary,
  StudioSession,
  StudioSessionSummary,
  StudioTrace,
  StudioTraceSummary,
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
import { AgentsPage } from "./modules/agents/agents-page";
import { KnowledgePage } from "./modules/knowledge/knowledge-page";
import { TranscriptItem } from "./modules/playground/transcript-item";
import { DeleteSessionDialog, SessionsPage } from "./modules/sessions/sessions-page";
import {
  errorMessage,
  formatRelativeTime,
  formatToolValue,
  titleFromText,
} from "./modules/shared/format";
import {
  logoSrc,
  pageLocationFromLocation,
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
  RunState,
  SessionLoadState,
  ToolApprovalUpdate,
  ToolQuestionUpdate,
  TraceLoadState,
  TranscriptEntry,
} from "./modules/shared/types";
import { NavButton } from "./modules/shell/nav-button";
import { TraceBrowser } from "./modules/tracing/trace-browser";

function applyDarkTheme(): void {
  document.documentElement.classList.add("dark");
}

export function StudioConsole() {
  const initialLocation = pageLocationFromLocation();
  const [config, setConfig] = useState<StudioConfig | undefined>();
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [allSessions, setAllSessions] = useState<StudioSessionSummary[]>([]);
  const [traces, setTraces] = useState<StudioTrace[]>([]);
  const [messages, setMessages] = useState<TranscriptEntry[]>([]);
  const [prompt, setPrompt] = useState("");
  const [activePage, setActivePage] = useState<ActivePage>(() => initialLocation.page);
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
  const [traceLoadState, setTraceLoadState] = useState<TraceLoadState>("idle");
  const [knowledge, setKnowledge] = useState<StudioKnowledgeSummary | undefined>();
  const [knowledgeLoadState, setKnowledgeLoadState] = useState<"idle" | "loading">("idle");
  const promptRef = useRef<HTMLTextAreaElement | null>(null);

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

  useEffect(() => {
    applyDarkTheme();
  }, []);

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

  async function createSession(title: string): Promise<StudioSessionSummary> {
    const response = await fetch("/sessions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        agentId: selectedAgentId,
        title,
        metadata: {
          source: "anvia-studio",
        },
      }),
    });
    if (!response.ok) {
      throw new Error(`Session create failed with HTTP ${response.status}`);
    }
    const session = (await response.json()) as StudioSessionSummary;
    setSelectedSessionId(session.id);
    setAllSessions((current) => [session, ...current.filter((item) => item.id !== session.id)]);
    updateSessionPath(session.id);
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
        const traceSummaries = await loadSessionTraceSummaries(session.id);
        setTranscriptSequence(nextSequence(session.transcript));
        setSelectedAgentId(session.agentId);
        setSelectedSessionId(session.id);
        setMessages(enrichTranscriptWithTraceIds(session.transcript, traceSummaries));
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
    [runState, loadSessionTraceSummaries],
  );

  const startNewChat = useCallback(
    (options: { updatePath?: boolean } = {}) => {
      if (runState === "running") {
        return;
      }
      resetTranscriptSequence();
      setSelectedSessionId("");
      setMessages([]);
      setPrompt("");
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
      resetTranscriptSequence();
      setSelectedSessionId("");
      setMessages([]);
      setPrompt("");
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
        setMessages([]);
        setPrompt("");
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
    if (trimmed.length === 0 || selectedAgentId.length === 0 || runState === "running") {
      return;
    }

    setRunState("running");
    setActivePage("playground");
    setError("");
    setPrompt("");
    requestAnimationFrame(() => resizeTextarea(promptRef.current));
    setMessages((current) => [
      ...current,
      { entryId: nextTranscriptId(), kind: "message", role: "user", text: trimmed },
    ]);

    try {
      const sessionId =
        sessionsEnabled && selectedSessionId.length === 0
          ? (await createSession(titleFromText(trimmed))).id
          : selectedSessionId;
      const history = sessionsEnabled ? undefined : toHistory(messages);
      const response = await fetch(`/agents/${encodeURIComponent(selectedAgentId)}/runs`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          message: trimmed,
          ...(sessionId.length === 0 ? {} : { sessionId }),
          ...(history === undefined ? {} : { history }),
          stream: true,
          metadata: {
            source: "anvia-studio",
          },
        }),
      });

      if (response.status === 401) {
        throw new Error("Authentication required");
      }
      if (!response.ok || response.body === null) {
        throw new Error(`Run failed with HTTP ${response.status}`);
      }

      await readJsonl(response.body, async (event) => {
        const visibleDelta = acceptStreamEvent(event as AgentRunStreamEvent);
        if (visibleDelta) {
          await nextPaint();
        }
      });
      await loadAllSessions();
      if (sessionId.length > 0) {
        setSelectedSessionId(sessionId);
        const traceSummaries = await loadSessionTraceSummaries(sessionId);
        setMessages((current) => enrichTranscriptWithTraceIds(current, traceSummaries));
      }
      setStatus("Connected");
    } catch (runError) {
      const message = errorMessage(runError);
      setError(message);
      appendAssistantText(`\n${message}`);
    } finally {
      setRunState("idle");
    }
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
      });
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
    if (event.type === "final" && event.trace?.traceId !== undefined) {
      assignAssistantTraceId(event.trace.traceId);
      return true;
    }
    if (event.type === "error") {
      setError(JSON.stringify(event.error));
    }
    return false;
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
      });
      return next;
    });
  }

  function updatePrompt(event: ChangeEvent<HTMLTextAreaElement>) {
    setPrompt(formValue(event));
    resizeTextarea(event.currentTarget);
  }

  function handlePromptKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }

    event.preventDefault();
    void runPrompt(prompt);
  }

  const agents = config?.agents ?? [];
  const selectedAgent =
    agents.find((agent) => agent.id === selectedAgentId) ?? agents[0] ?? undefined;
  const selectedAgentQuickPrompts = selectedAgent?.quickPrompts ?? [];
  const hasMessages = messages.length > 0;

  function navigatePage(page: ActivePage) {
    setActivePage(page);
    if (page === "tracing") {
      setSelectedTraceId("");
      setTraceSessionDetailId(undefined);
      updatePagePath("tracing");
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
    <div className="grid min-h-screen overflow-hidden bg-background text-foreground lg:grid-cols-[224px_minmax(0,1fr)]">
      <aside className="flex min-h-screen flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
        <div className="flex h-20 items-center border-b border-sidebar-border px-5">
          <div className="flex min-w-0 items-center gap-3">
            <img className="h-11 w-11 shrink-0 object-contain" src={logoSrc} alt="" />
            <span className="grid min-w-0">
              <span className="anvia-wordmark truncate text-2xl font-semibold tracking-normal text-sidebar-foreground">
                Anvia
              </span>
            </span>
          </div>
        </div>
        <nav className="grid gap-1 border-b border-sidebar-border px-3 py-3" aria-label="Main">
          <NavButton
            active={activePage === "playground"}
            icon="message"
            label="Chat"
            onClick={() => navigatePage("playground")}
          />
          <NavButton
            active={activePage === "sessions"}
            icon="list"
            label="Sessions"
            onClick={() => navigatePage("sessions")}
          />
          <NavButton
            active={activePage === "tracing"}
            icon="activity"
            label="Traces"
            onClick={() => navigatePage("tracing")}
          />
        </nav>
        <nav className="grid gap-1 border-b border-sidebar-border px-3 py-3" aria-label="Studio">
          <NavButton
            active={activePage === "agents"}
            icon="bot"
            label="Studio"
            onClick={() => navigatePage("agents")}
          />
          <NavButton
            active={activePage === "knowledge"}
            icon="database"
            label="Knowledge"
            onClick={() => navigatePage("knowledge")}
          />
        </nav>
        <div className="mt-auto border-t border-sidebar-border p-4">
          <span className="flex min-w-0 items-center gap-2 truncate font-mono text-[11px] font-semibold text-primary">
            <span className="relative flex h-2 w-2 shrink-0" aria-hidden="true">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-55" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
            </span>
            {status}
          </span>
        </div>
      </aside>

      <main className="grid h-screen min-w-0 grid-rows-[42px_minmax(0,1fr)] overflow-hidden bg-background">
        <header className="grid min-h-10 border-b border-border bg-background">
          <div className="grid min-h-10 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-5">
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
                className="h-7 min-h-7 border-transparent bg-transparent px-3 font-mono text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                type="button"
                variant="secondary"
                onClick={() => navigatePage("agents")}
              >
                See config
              </Button>
              <Button
                className="h-7 min-h-7 border-transparent bg-transparent px-3 font-mono text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                type="button"
                variant="secondary"
                onClick={() => navigatePage("sessions")}
              >
                Sessions
              </Button>
              <Button
                className="h-7 min-h-7 gap-1.5 rounded-sm border-0 bg-primary px-3 font-mono text-xs text-primary-foreground hover:bg-primary/90"
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
          <section className="grid min-h-0 grid-cols-[minmax(0,1fr)_310px] overflow-hidden bg-background max-xl:grid-cols-1">
            <div className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto] overflow-hidden">
              <section className="min-h-0 overflow-auto px-6 py-5">
                <div className="mx-auto grid min-h-full w-full max-w-210 content-start items-start gap-5 pb-6">
                  {!hasMessages ? (
                    <div className="grid min-h-80 place-items-center text-sm font-medium text-muted-foreground">
                      No messages
                    </div>
                  ) : null}
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
                </div>
              </section>
              <form
                className="grid gap-2 bg-background px-6 pb-5"
                onSubmit={(event) => {
                  event.preventDefault();
                  void runPrompt(prompt);
                }}
              >
                {hasMessages || selectedAgentQuickPrompts.length === 0 ? null : (
                  <div className="mx-auto grid w-full max-w-210 grid-cols-3 gap-2 max-md:grid-cols-1">
                    {selectedAgentQuickPrompts.map((quickPrompt) => (
                      <Button
                        className="h-auto min-h-14 justify-start whitespace-normal rounded-sm border border-border bg-card px-3 py-2 text-left text-sm font-medium leading-5 text-foreground hover:border-primary/45 hover:bg-primary/10 hover:text-primary"
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
                <div className="mx-auto grid w-full max-w-210 gap-2 rounded-lg border border-border bg-card p-2.5 shadow-xl focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/25">
                  <Textarea
                    className="min-h-14 min-w-0 resize-none rounded-md border-0 bg-transparent px-3 py-3 text-sm text-foreground shadow-none outline-none ring-0 placeholder:text-muted-foreground/70 focus:border-transparent focus:ring-0"
                    ref={promptRef}
                    rows={1}
                    value={prompt}
                    onChange={updatePrompt}
                    onKeyDown={handlePromptKeyDown}
                    placeholder="Ask anything..."
                  />
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <Button
                        aria-label="Attach context"
                        className="h-8 min-h-8 w-8 rounded-full border-border bg-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                        size="icon"
                        type="button"
                        variant="secondary"
                      >
                        <Plus aria-hidden="true" />
                      </Button>
                    </div>
                    <div className="flex min-w-0 items-center gap-2">
                      {agents.length > 1 ? (
                        <Select
                          value={selectedAgent?.id ?? selectedAgentId}
                          onValueChange={selectPlaygroundAgent}
                          disabled={runState === "running"}
                        >
                          <SelectTrigger
                            aria-label="Select agent"
                            className="hidden h-8 min-h-8 w-auto max-w-64 gap-2 border-0 bg-transparent px-2 py-1 font-mono text-xs font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground sm:flex"
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
                        <span className="hidden max-w-60 truncate rounded-sm px-2 py-1 font-mono text-xs font-medium text-muted-foreground sm:block">
                          {selectedAgent?.name ?? selectedAgent?.id ?? "Agent"}
                        </span>
                      )}
                      <Button
                        aria-label={runState === "running" ? "Running" : "Send message"}
                        className="h-9 min-h-9 w-9 rounded-sm border-primary bg-primary text-primary-foreground hover:bg-primary/90 dark:hover:bg-[#eaff73]"
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
            <aside className="min-h-0 overflow-auto border-l border-border px-3 py-5 max-xl:hidden">
              <div className="grid gap-1">
                {allSessions.slice(0, 12).map((session) => (
                  <div
                    className={cn(
                      "group grid min-h-10 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 border-l border-transparent bg-transparent px-3 py-1 text-left hover:bg-accent",
                      session.id === selectedSessionId &&
                        "border-primary bg-accent text-accent-foreground",
                    )}
                    key={session.id}
                  >
                    <Button
                      className="h-auto min-h-0 min-w-0 justify-start rounded-none border-0 bg-transparent p-0 text-left text-inherit hover:bg-transparent hover:text-inherit"
                      type="button"
                      variant="ghost"
                      onClick={() => void loadSession(session.id)}
                    >
                      <span className="min-w-0 truncate text-sm font-medium">
                        {session.title ?? "Untitled chat"}
                      </span>
                    </Button>
                    <time className="self-center justify-self-end font-mono text-xs font-medium tabular-nums text-muted-foreground">
                      {formatRelativeTime(session.updatedAt)}
                    </time>
                    <Button
                      aria-label={`Delete ${session.title ?? "Untitled chat"}`}
                      className="h-7 min-h-7 w-7 border-0 bg-transparent p-0 text-muted-foreground opacity-70 hover:bg-transparent hover:text-destructive hover:opacity-100 focus-visible:opacity-100 [&_svg]:h-3.5 [&_svg]:w-3.5"
                      size="icon"
                      type="button"
                      variant="ghost"
                      onClick={(event) => {
                        event.stopPropagation();
                        setDeleteCandidate(session);
                      }}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </div>
                ))}
              </div>
            </aside>
          </section>
        ) : null}

        {activePage === "tracing" ? (
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
        ) : null}

        {activePage === "sessions" ? (
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
        ) : null}

        {activePage === "agents" ? (
          <AgentsPage agents={agents} selectedAgentId={selectedAgentId} />
        ) : null}

        {activePage === "knowledge" ? (
          <KnowledgePage
            enabled={knowledgeEnabled}
            summary={knowledge}
            loading={knowledgeLoadState === "loading"}
            onOpenTrace={selectTrace}
            onRefresh={() => void loadKnowledge()}
          />
        ) : null}
      </main>
      <DeleteSessionDialog
        session={deleteCandidate}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteCandidate(undefined);
          }
        }}
        onConfirm={(session) => void deleteSession(session)}
      />
    </div>
  );
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
