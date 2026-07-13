import {
  createChatTransport,
  type ToolApproval,
  type ToolQuestion,
  type ToolQuestionAnswer,
  useChat,
} from "@anvia/react";
import { type RefObject, useEffect, useRef } from "react";
import type { AgentRunStreamEvent, StudioConfig, StudioTraceSummary } from "../../../../types";
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
  const playgroundVisibleEventRef = useRef<Promise<void>>(Promise.resolve());

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
    createRequest: ({ coreMessages }) => {
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
    eventToDelta: () => undefined,
    eventToFinal: () => undefined,
    humanInput: {
      eventToApproval: (event) =>
        event.type === "tool_approval_request" || event.type === "tool_approval_result"
          ? event.approval
          : undefined,
      eventToQuestion: (event) =>
        event.type === "tool_question_request" || event.type === "tool_question_result"
          ? event.question
          : undefined,
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
      const visibleDelta = acceptStreamEvent(event);
      if (visibleDelta) {
        playgroundVisibleEventRef.current = playgroundVisibleEventRef.current.then(nextPaint);
      }
    },
    onError(error) {
      playgroundRunErrorRef.current = error;
      const message = agentRunErrorMessage(error);
      onError(message);
      transcript.appendAssistantError(message);
    },
  });

  useEffect(() => {
    onRunStateChange(playgroundChat.status === "streaming" ? "running" : "idle");
  }, [onRunStateChange, playgroundChat.status]);

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
        onStatus("Connected");
      }
    } catch (runError) {
      const message = errorMessage(runError);
      onError(message);
      transcript.appendAssistantError(message);
    } finally {
      playgroundRunRequestRef.current = undefined;
      playgroundChat.reset();
      onRunStateChange("idle");
    }
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

  function acceptStreamEvent(event: AgentRunStreamEvent): boolean {
    if (event.type === "text_delta") {
      transcript.appendAssistantText(event.delta);
      return true;
    }
    if (event.type === "reasoning_delta") {
      transcript.appendReasoningText(event.delta, event.id);
      return true;
    }
    if (event.type === "tool_call") {
      transcript.appendToolCall(
        event.toolCall.function.name,
        formatToolValue(event.toolCall.function.arguments),
        event.toolCall.callId ?? event.toolCall.id,
      );
      return true;
    }
    if (event.type === "tool_result") {
      const result: Parameters<typeof transcript.appendToolResult>[0] = {
        toolName: event.toolName,
        callId: event.toolCallId,
        args: event.args,
        result: event.result,
      };
      if (event.structuredResult !== undefined) result.structuredResult = event.structuredResult;
      transcript.appendToolResult(result);
      return true;
    }
    if (event.type === "agent_tool_event") {
      transcript.appendAgentToolEvent(event);
      return true;
    }
    if (event.type === "tool_approval_request") {
      transcript.updateToolApproval(event.approval);
      return true;
    }
    if (event.type === "tool_approval_result") {
      transcript.updateToolApproval(event.approval);
      return true;
    }
    if (event.type === "tool_question_request") {
      transcript.updateToolQuestion(event.question);
      return true;
    }
    if (event.type === "tool_question_result") {
      transcript.updateToolQuestion(event.question);
      return true;
    }
    if (event.type === "session_log") {
      sessions.appendSessionLogEntry(event.log);
      return true;
    }
    if (event.type === "final") {
      if (event.trace?.traceId !== undefined) {
        transcript.assignAssistantTraceId(event.trace.traceId);
      }
      transcript.clearPendingAssistant();
      return true;
    }
    if (event.type === "error") {
      const message = serializedStreamErrorText(event.error);
      playgroundRunErrorRef.current = event.error;
      onError(message);
      transcript.appendAssistantError(message);
      return true;
    }
    return false;
  }

  return {
    answeringQuestions: new Set(playgroundChat.answeringQuestions),
    decidingApprovals: new Set(playgroundChat.decidingApprovals),
    answerToolQuestion,
    decideToolApproval,
    runPrompt,
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
  if (question.answers !== undefined) update.answers = question.answers;
  return update;
}
