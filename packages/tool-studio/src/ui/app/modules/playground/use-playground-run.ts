import type { ClientStreamEvent, ClientStreamRequest, ClientTransport } from "@anvia/client";
import { createHttpClientTransport } from "@anvia/client";
import type { Message } from "@anvia/core/completion";
import { useChat } from "@anvia/react";
import { type RefObject, useMemo, useRef } from "react";
import type { StudioConfig, StudioSessionLogEntry, StudioTraceSummary } from "../../../../types";
import { agentRunErrorMessage, serializedStreamErrorText } from "../../app-errors";
import {
  enrichTranscriptWithTraceIds,
  type PromptAttachment,
  type StudioAgentRunRequest,
  studioModelRefFromKey,
  transcriptAttachmentsForPrompt,
  uiAttachmentsForPrompt,
} from "../../app-helpers";
import type { useStudioSessions } from "../sessions/use-studio-sessions";
import { errorMessage, formatToolValue, titleFromText } from "../shared/format";
import { nextPaint, nextTranscriptId, resizeTextarea, toHistory } from "../shared/transcript";
import type { ActivePage, RunState, TranscriptEntry } from "../shared/types";
import type { useTraces } from "../tracing/use-traces";
import type { usePlaygroundTranscript } from "./use-playground-transcript";

type PlaygroundTranscriptController = ReturnType<typeof usePlaygroundTranscript>;
type StudioSessionsController = ReturnType<typeof useStudioSessions>;
type StudioTracesController = ReturnType<typeof useTraces>;
type PlaygroundRunRequestContext = Omit<
  Extract<StudioAgentRunRequest, { type: "messages" }>,
  "messages" | "type"
> & {
  history?: readonly Message[];
};

const studioAgentTransport = createHttpClientTransport<StudioAgentRunRequest>({
  endpoint: ({ request }) => `/agents/${encodeURIComponent(request.agentId)}/runs`,
  format: "jsonl",
  headers: { "content-type": "application/json" },
  body: ({ request }) => {
    const { agentId: _agentId, ...body } = request;
    return JSON.stringify(body);
  },
});

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
  onToolCall: (toolName: string) => void;
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
    onToolCall,
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
  const playgroundWaitingRef = useRef(false);
  const playgroundRunStartedAtRef = useRef<number | undefined>(undefined);
  const playgroundVisibleEventRef = useRef<Promise<void>>(Promise.resolve());

  const playgroundTransport = useMemo<ClientTransport<ClientStreamRequest>>(
    () => ({
      send(options) {
        const context = playgroundRunRequestRef.current;
        if (context === undefined) {
          throw new Error("Missing playground run request");
        }
        if (options.request.type === "interaction_response") {
          return studioAgentTransport.send({
            ...options,
            request: {
              agentId: context.agentId,
              ...options.request,
              stream: true,
              ...(context.metadata === undefined ? {} : { metadata: context.metadata }),
            },
          });
        }
        const prompt = options.request.messages.at(-1);
        if (prompt === undefined || prompt.role !== "user") {
          throw new Error("Missing playground prompt message");
        }
        return studioAgentTransport.send({
          ...options,
          request: runRequestFromContext(context, prompt),
        });
      },
    }),
    [],
  );

  const playgroundChat = useChat({
    transport: playgroundTransport,
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
    playgroundWaitingRef.current = false;
    onRunStateChange("running");
    onBeforeRun();
    onActivePageChange("playground");
    onError("");
    onPromptChange("");
    onAttachmentsChange([]);
    requestAnimationFrame(() => resizeTextarea(promptRef.current));
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
        stream: true,
        metadata,
      };
      if (sessionId.length > 0) runContext.sessionId = sessionId;
      if (history !== undefined) runContext.history = history;
      if (selectedModelRef.length > 0) {
        runContext.model = studioModelRefFromKey(selectedModelRef);
      }
      playgroundRunRequestRef.current = runContext;
      const startedAt = Date.now();
      playgroundRunStartedAtRef.current = startedAt;

      await playgroundChat.sendMessage({
        text: trimmed,
        attachments: uiAttachmentsForPrompt(promptAttachments),
      });
      await playgroundVisibleEventRef.current;
      if (playgroundWaitingRef.current) {
        return;
      }

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
      if (!playgroundWaitingRef.current) {
        completeWorkingRun();
        playgroundRunRequestRef.current = undefined;
        playgroundChat.reset();
        onRunStateChange("idle");
      }
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

  function decideToolApproval(interactionId: string, approved: boolean) {
    onError("");
    playgroundWaitingRef.current = false;
    const decision = playgroundChat.respondToInteraction({
      interactionId,
      response: { type: "tool-approval", approved },
    });
    void decision
      .then(() => {
        transcript.resolveToolApproval(interactionId, approved);
        finishInteractionPhase();
      })
      .catch((decisionError) => onError(errorMessage(decisionError)));
  }

  function answerToolQuestion(
    interactionId: string,
    answers: Array<{ questionId: string; answer: string; choice?: string; custom?: boolean }>,
  ) {
    onError("");
    playgroundWaitingRef.current = false;
    void playgroundChat
      .respondToInteraction({
        interactionId,
        response: {
          type: "tool-question",
          answers: answers.map((answer) => ({
            questionId: answer.questionId,
            value: answer.custom === true ? answer.answer : (answer.choice ?? answer.answer),
          })),
        },
      })
      .then(() => {
        transcript.resolveToolQuestion(interactionId, answers);
        finishInteractionPhase();
      })
      .catch((answerError) => onError(errorMessage(answerError)));
  }

  function finishInteractionPhase() {
    if (playgroundWaitingRef.current) return;
    completeWorkingRun();
    playgroundRunRequestRef.current = undefined;
    playgroundChat.reset();
    onRunStateChange("idle");
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
      onToolCall(event.toolName);
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
    if (event.type === "interaction") {
      const requestedAt = new Date().toISOString();
      if (event.interaction.type === "tool-approval") {
        transcript.updateToolApproval({
          id: event.interaction.id,
          toolName: event.interaction.toolName,
          callId: event.interaction.callId ?? event.interaction.toolCallId,
          status: "pending",
          requestedAt,
          ...(event.interaction.reason === undefined ? {} : { reason: event.interaction.reason }),
        });
      } else {
        transcript.updateToolQuestion({
          id: event.interaction.id,
          toolName: event.interaction.toolName,
          callId: event.interaction.callId ?? event.interaction.toolCallId,
          status: "pending",
          requestedAt,
          questions: event.interaction.questions.map((question) => ({
            id: question.id,
            question: question.text,
            choices: [...(question.choices ?? [])],
            allowCustom: question.choices === undefined || question.allowCustom === true,
          })),
        });
      }
      return true;
    }
    if (event.type === "data" && event.name === "studio.session_log") {
      sessions.appendSessionLogEntry(event.data as unknown as StudioSessionLogEntry);
      return true;
    }
    if (event.type === "run_end") {
      if (event.status === "suspended") {
        playgroundWaitingRef.current = true;
        onRunStateChange("idle");
        onStatus("Waiting for input");
        return true;
      }
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
    answeringQuestions: new Set(playgroundChat.respondingInteractions),
    decidingApprovals: new Set(playgroundChat.respondingInteractions),
    isStreaming: playgroundChat.status === "submitted" || playgroundChat.status === "streaming",
    answerToolQuestion,
    decideToolApproval,
    runPrompt,
    stopPrompt,
  };
}

function runRequestFromContext(
  context: PlaygroundRunRequestContext,
  message: Message,
): StudioAgentRunRequest {
  const request: StudioAgentRunRequest = {
    agentId: context.agentId,
    type: "messages",
    messages: context.sessionId === undefined ? [...(context.history ?? []), message] : [message],
    ...(context.stream === undefined ? {} : { stream: context.stream }),
    ...(context.metadata === undefined ? {} : { metadata: context.metadata }),
  };
  if (context.sessionId !== undefined) request.sessionId = context.sessionId;
  if (context.model !== undefined) request.model = context.model;
  return request;
}
