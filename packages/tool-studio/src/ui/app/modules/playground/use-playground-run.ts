import type {
  ClientStreamEvent,
  ToolApproval,
  ToolQuestion,
  ToolQuestionAnswer,
} from "@anvia/client";
import { useChat } from "@anvia/react";
import { type RefObject, useRef } from "react";
import type { StudioConfig, StudioSessionLogEntry, StudioTraceSummary } from "../../../../types";
import { agentRunErrorMessage, serializedStreamErrorText } from "../../app-errors";
import {
  enrichTranscriptWithTraceIds,
  type PromptAttachment,
  type StudioAgentRunRequest,
  transcriptAttachmentsForPrompt,
  userUIMessageWithAttachments,
} from "../../app-helpers";
import type { useStudioSessions } from "../sessions/use-studio-sessions";
import { errorMessage, formatToolValue, titleFromText } from "../shared/format";
import { nextPaint, nextTranscriptId, resizeTextarea, toHistory } from "../shared/transcript";
import type {
  ActivePage,
  RunState,
  ToolApprovalUpdate,
  ToolQuestionUpdate,
  TranscriptEntry,
} from "../shared/types";
import type { useTraces } from "../tracing/use-traces";
import type { usePlaygroundTranscript } from "./use-playground-transcript";

type PlaygroundTranscriptController = ReturnType<typeof usePlaygroundTranscript>;
type StudioSessionsController = ReturnType<typeof useStudioSessions>;
type StudioTracesController = ReturnType<typeof useTraces>;
type PlaygroundRunRequestContext = Omit<StudioAgentRunRequest, "message"> & {
  promptText: string;
  useTextMessage: boolean;
};

export function usePlaygroundRun(props: {
  attachments: PromptAttachment[];
  messages: TranscriptEntry[];
  promptRef: RefObject<HTMLTextAreaElement | null>;
  runState: RunState;
  selectedAgent: StudioConfig["agents"][number] | undefined;
  selectedAgentId: string;
  selectedModelRef: string;
  sessions: StudioSessionsController;
  sessionsEnabled: boolean;
  traces: StudioTracesController;
  transcript: PlaygroundTranscriptController;
  onActivePageChange: (page: ActivePage) => void;
  onAttachmentsChange: (attachments: PromptAttachment[]) => void;
  onBeforeRun: () => void;
  onError: (message: string) => void;
  onPromptChange: (prompt: string) => void;
  onRunStateChange: (runState: RunState) => void;
  onSessionTraceSummariesChange: (traceSummaries: StudioTraceSummary[]) => void;
  onStatus: (status: string) => void;
}) {
  const {
    attachments,
    messages,
    onActivePageChange,
    onAttachmentsChange,
    onBeforeRun,
    onError,
    onPromptChange,
    onRunStateChange,
    onSessionTraceSummariesChange,
    onStatus,
    promptRef,
    runState,
    selectedAgent,
    selectedAgentId,
    selectedModelRef,
    sessions,
    sessionsEnabled,
    traces,
    transcript,
  } = props;
  const playgroundRunRequestRef = useRef<PlaygroundRunRequestContext | undefined>(undefined);
  const playgroundRunErrorRef = useRef<unknown>(undefined);
  const playgroundRunStoppedRef = useRef(false);
  const playgroundRunTerminalRef = useRef(false);
  const playgroundRunStartedAtRef = useRef<number | undefined>(undefined);
  const playgroundVisibleEventRef = useRef<Promise<void>>(Promise.resolve());

  const playgroundChat = useChat<StudioAgentRunRequest>({
    endpoint: (request) => `/agents/${encodeURIComponent(request.agentId)}/runs`,
    format: "jsonl",
    headers: { "content-type": "application/json" },
    body: (request) => {
      const { agentId: _agentId, ...body } = request;
      return JSON.stringify(body);
    },
    createRequest: ({ messages: coreMessages }) => {
      const context = playgroundRunRequestRef.current;
      if (context === undefined) {
        throw new Error("Missing playground run request");
      }
      const message = context.useTextMessage ? context.promptText : coreMessages.at(-1);
      if (message === undefined) {
        throw new Error("Missing playground prompt message");
      }
      return runRequestFromContext(context, message);
    },
    humanInput: {
      decideApproval: async (input) => {
        const response = await fetch(
          `/approvals/${encodeURIComponent(input.approvalId)}/decision`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ approved: input.approved }),
          },
        );
        if (!response.ok) {
          throw new Error(`Approval decision failed with HTTP ${response.status}`);
        }
        const approval = (await response.json()) as ToolApproval;
        updateTranscriptApproval(transcript, approval);
        return approval;
      },
      answerQuestion: async (input) => {
        const response = await fetch(`/questions/${encodeURIComponent(input.questionId)}/answer`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ answers: input.answers }),
        });
        if (!response.ok) {
          throw new Error(`Question answer failed with HTTP ${response.status}`);
        }
        const question = (await response.json()) as ToolQuestion;
        updateTranscriptQuestion(transcript, question);
        return question;
      },
    },
    onEvent(event) {
      if (playgroundRunTerminalRef.current) {
        return;
      }
      const visibleDelta = acceptStreamEvent(event);
      if (visibleDelta) {
        playgroundVisibleEventRef.current = playgroundVisibleEventRef.current.then(nextPaint);
      }
    },
    onError(error) {
      if (playgroundRunStoppedRef.current || playgroundRunTerminalRef.current) {
        return;
      }
      playgroundRunTerminalRef.current = true;
      playgroundRunErrorRef.current = error;
      const message = agentRunErrorMessage(error);
      onError(message);
      transcript.appendAssistantError(message);
      completeWorkingRun();
    },
  });

  async function runPrompt(text: string) {
    const trimmed = text.trim();
    const promptAttachments = attachments;
    const agentId = selectedAgent?.id ?? selectedAgentId;
    if (
      (trimmed.length === 0 && promptAttachments.length === 0) ||
      agentId.length === 0 ||
      runState === "running" ||
      playgroundChat.status === "submitted" ||
      playgroundChat.status === "streaming"
    ) {
      return;
    }

    playgroundRunStoppedRef.current = false;
    playgroundRunTerminalRef.current = false;
    onRunStateChange("running");
    onBeforeRun();
    onActivePageChange("playground");
    onError("");
    onPromptChange("");
    onAttachmentsChange([]);
    requestAnimationFrame(() => resizeTextarea(promptRef.current));
    const promptMessage =
      promptAttachments.length === 0
        ? { text: trimmed }
        : userUIMessageWithAttachments(trimmed, promptAttachments);
    transcript.setMessages((current) => {
      const userEntry: TranscriptEntry = {
        entryId: nextTranscriptId(),
        kind: "message",
        role: "user",
        text: trimmed,
      };
      if (promptAttachments.length > 0) {
        userEntry.attachments = transcriptAttachmentsForPrompt(promptAttachments);
      }
      return [
        ...current,
        userEntry,
        {
          entryId: nextTranscriptId(),
          kind: "message",
          role: "assistant",
          text: "",
          tone: "pending",
        },
      ];
    });

    try {
      const shouldCreateSession = sessionsEnabled && sessions.selectedSessionId.length === 0;
      const sessionId = shouldCreateSession
        ? (await sessions.createSession(titleFromText(trimmed), { updatePath: false })).id
        : sessions.selectedSessionId;
      const history = sessionsEnabled ? undefined : toHistory(messages);
      playgroundRunErrorRef.current = undefined;
      playgroundVisibleEventRef.current = Promise.resolve();
      const metadata: StudioAgentRunRequest["metadata"] = { source: "anvia-studio" };
      if (selectedModelRef.length > 0) metadata.studioModel = selectedModelRef;
      const runContext: PlaygroundRunRequestContext = {
        agentId,
        promptText: trimmed,
        useTextMessage: promptAttachments.length === 0,
        stream: true,
        metadata,
      };
      if (sessionId.length > 0) runContext.sessionId = sessionId;
      if (history !== undefined) runContext.history = history;
      if (selectedModelRef.length > 0) runContext.model = selectedModelRef;
      playgroundRunRequestRef.current = runContext;
      const startedAt = Date.now();
      playgroundRunStartedAtRef.current = startedAt;

      await playgroundChat.sendMessage(promptMessage);
      await playgroundVisibleEventRef.current;

      if (playgroundRunErrorRef.current === undefined) {
        await sessions.loadAllSessions();
        if (sessionId.length > 0) {
          sessions.setSelectedSessionId(sessionId);
          const [traceSummaries] = await Promise.all([
            traces.loadSessionTraceSummaries(sessionId),
            sessions.loadSessionLogs(sessionId),
          ]);
          onSessionTraceSummariesChange(traceSummaries);
          transcript.setMessages((current) =>
            enrichTranscriptWithTraceIds(current, traceSummaries),
          );
          if (shouldCreateSession) {
            sessions.openSessionPath(sessionId);
          }
        }
        onStatus(playgroundRunStoppedRef.current ? "Stopped" : "Connected");
      }
    } catch (runError) {
      if (!playgroundRunStoppedRef.current && !playgroundRunTerminalRef.current) {
        playgroundRunTerminalRef.current = true;
        const message = errorMessage(runError);
        onError(message);
        transcript.appendAssistantError(message);
        completeWorkingRun();
      }
    } finally {
      completeWorkingRun();
      playgroundRunRequestRef.current = undefined;
      playgroundChat.reset();
      onRunStateChange("idle");
    }
  }

  function stopPrompt() {
    if (
      (playgroundChat.status !== "submitted" && playgroundChat.status !== "streaming") ||
      playgroundRunTerminalRef.current
    ) {
      return;
    }
    playgroundRunStoppedRef.current = true;
    playgroundRunTerminalRef.current = true;
    const durationMs = stopWorkingClock();
    playgroundChat.stop();
    transcript.cancelPendingRun(durationMs ?? 0);
    onStatus("Stopping");
  }

  function decideToolApproval(approvalId: string, approved: boolean) {
    onError("");
    const decision = approved
      ? playgroundChat.approveTool(approvalId)
      : playgroundChat.rejectTool(approvalId);
    void decision.catch((decisionError) => onError(errorMessage(decisionError)));
  }

  function answerToolQuestion(questionId: string, answers: ToolQuestionAnswer[]) {
    onError("");
    void playgroundChat
      .answerToolQuestion(questionId, answers)
      .catch((answerError) => onError(errorMessage(answerError)));
  }

  function acceptStreamEvent(event: ClientStreamEvent): boolean {
    if (event.scope?.parentToolCallId !== undefined) {
      transcript.appendAgentToolEvent(event);
      return true;
    }
    if (event.type === "text_delta") {
      transcript.appendAssistantText(event.delta);
      return true;
    }
    if (event.type === "reasoning_delta") {
      transcript.appendReasoningText(event.delta, event.partId);
      return true;
    }
    if (event.type === "tool_call_end") {
      transcript.appendToolCall(
        event.toolName,
        formatToolValue(event.input),
        event.callId ?? event.toolCallId,
      );
      return true;
    }
    if (event.type === "tool_result") {
      const result: Parameters<typeof transcript.appendToolResult>[0] = {
        toolName: event.toolName,
        callId: event.callId ?? event.toolCallId,
        args: formatToolValue(event.input),
        result:
          event.result.status === "success"
            ? formatToolValue(event.result.output)
            : event.result.error.message,
      };
      if (event.result.status === "success" && event.result.content !== undefined) {
        result.structuredResult = event.result.content;
      }
      transcript.appendToolResult(result);
      return true;
    }
    if (event.type === "tool_approval") {
      const update = transcriptApprovalUpdate(event.approval);
      if (update !== undefined) transcript.updateToolApproval(update);
      return true;
    }
    if (event.type === "tool_question") {
      const update = transcriptQuestionUpdate(event.question);
      if (update !== undefined) transcript.updateToolQuestion(update);
      return true;
    }
    if (event.type === "data" && event.name === "studio.session_log") {
      sessions.appendSessionLogEntry(event.data as unknown as StudioSessionLogEntry);
      return true;
    }
    if (event.type === "run_end") {
      playgroundRunTerminalRef.current = true;
      if (event.trace?.traceId !== undefined) {
        transcript.assignAssistantTraceId(event.trace.traceId);
      }
      transcript.clearPendingAssistant();
      completeWorkingRun();
      return true;
    }
    if (event.type === "error") {
      playgroundRunTerminalRef.current = true;
      const message = serializedStreamErrorText(event.error);
      playgroundRunErrorRef.current = event.error;
      onError(message);
      transcript.appendAssistantError(message);
      completeWorkingRun();
      return true;
    }
    return false;
  }

  function completeWorkingRun() {
    const durationMs = stopWorkingClock();
    if (durationMs !== undefined) {
      transcript.completeRun(durationMs);
    }
  }

  function stopWorkingClock(): number | undefined {
    const startedAt = playgroundRunStartedAtRef.current;
    if (startedAt === undefined) {
      return undefined;
    }
    playgroundRunStartedAtRef.current = undefined;
    return Date.now() - startedAt;
  }

  return {
    answeringQuestions: new Set(playgroundChat.answeringQuestions),
    decidingApprovals: new Set(playgroundChat.decidingApprovals),
    isStreaming: playgroundChat.status === "submitted" || playgroundChat.status === "streaming",
    answerToolQuestion,
    decideToolApproval,
    runPrompt,
    stopPrompt,
  };
}

function runRequestFromContext(
  context: PlaygroundRunRequestContext,
  message: StudioAgentRunRequest["message"],
): StudioAgentRunRequest {
  const request: StudioAgentRunRequest = {
    agentId: context.agentId,
    message,
    stream: context.stream,
    metadata: context.metadata,
  };
  if (context.sessionId !== undefined) request.sessionId = context.sessionId;
  if (context.history !== undefined) request.history = context.history;
  if (context.model !== undefined) request.model = context.model;
  return request;
}

function updateTranscriptApproval(
  transcript: PlaygroundTranscriptController,
  approval: ToolApproval,
) {
  const update = transcriptApprovalUpdate(approval);
  if (update !== undefined) {
    transcript.updateToolApproval(update);
  }
}

function updateTranscriptQuestion(
  transcript: PlaygroundTranscriptController,
  question: ToolQuestion,
) {
  const update = transcriptQuestionUpdate(question);
  if (update !== undefined) {
    transcript.updateToolQuestion(update);
  }
}

function transcriptApprovalUpdate(approval: ToolApproval): ToolApprovalUpdate | undefined {
  if (approval.requestedAt === undefined) {
    return undefined;
  }
  const update: ToolApprovalUpdate = {
    id: approval.id,
    toolName: approval.toolName,
    status: approval.status,
    requestedAt: approval.requestedAt,
  };
  if (approval.callId !== undefined) update.callId = approval.callId;
  if (approval.resolvedAt !== undefined) update.resolvedAt = approval.resolvedAt;
  if (approval.reason !== undefined) update.reason = approval.reason;
  return update;
}

function transcriptQuestionUpdate(question: ToolQuestion): ToolQuestionUpdate | undefined {
  if (question.requestedAt === undefined) {
    return undefined;
  }
  const update: ToolQuestionUpdate = {
    id: question.id,
    toolName: question.toolName,
    status: question.status,
    requestedAt: question.requestedAt,
    questions: question.questions,
  };
  if (question.callId !== undefined) update.callId = question.callId;
  if (question.answeredAt !== undefined) update.answeredAt = question.answeredAt;
  if (question.cancelledAt !== undefined) update.cancelledAt = question.cancelledAt;
  if (question.answers !== undefined) update.answers = question.answers;
  return update;
}
