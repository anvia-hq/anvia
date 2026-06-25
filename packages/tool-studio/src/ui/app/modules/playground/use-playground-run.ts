import { createChatTransport, useChat } from "@anvia/react";
import { type RefObject, useEffect, useRef } from "react";
import type { AgentRunStreamEvent, StudioConfig } from "../../../../types";
import { agentRunErrorMessage, serializedStreamErrorText } from "../../app-errors";
import {
  enrichTranscriptWithTraceIds,
  type PromptAttachment,
  type StudioAgentRunRequest,
  transcriptAttachmentsForPrompt,
  userMessageWithAttachments,
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
  const playgroundRunRequestRef = useRef<StudioAgentRunRequest | undefined>(undefined);
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
        ? trimmed
        : userMessageWithAttachments(trimmed, promptAttachments);
    transcript.setMessages((current) => [
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
      {
        entryId: nextTranscriptId(),
        kind: "message",
        role: "assistant",
        text: "",
        tone: "pending",
      },
    ]);

    try {
      const shouldCreateSession = sessionsEnabled && sessions.selectedSessionId.length === 0;
      const sessionId = shouldCreateSession
        ? (await sessions.createSession(titleFromText(trimmed), { updatePath: false })).id
        : sessions.selectedSessionId;
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
        await sessions.loadAllSessions();
        if (sessionId.length > 0) {
          sessions.setSelectedSessionId(sessionId);
          const [traceSummaries] = await Promise.all([
            traces.loadSessionTraceSummaries(sessionId),
            sessions.loadSessionLogs(sessionId),
          ]);
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
      transcript.appendToolResult({
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
    runPrompt,
  };
}
