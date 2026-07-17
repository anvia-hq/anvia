import { useParams } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { PlaygroundPage } from "../modules/playground/playground-page";
import { useActivatedRoute } from "./route-helpers";

export function PlaygroundRoute() {
  const studio = useActivatedRoute("playground");
  const params = useParams({ strict: false }) as { sessionId?: string };
  const sessionId = params.sessionId;
  const handledSessionIdRef = useRef<string | undefined | null>(null);

  useEffect(() => {
    if (handledSessionIdRef.current === sessionId) {
      return;
    }
    if (!studio.pageEnabled("playground")) {
      return;
    }
    if (studio.runState === "running") {
      handledSessionIdRef.current = sessionId;
      return;
    }
    if (sessionId === undefined) {
      handledSessionIdRef.current = sessionId;
      studio.startNewChat({ updatePath: false });
      return;
    }
    if (!studio.sessionsEnabled) {
      return;
    }
    handledSessionIdRef.current = sessionId;
    if (sessionId !== studio.sessions.selectedSessionId) {
      void studio.sessions.loadSession(sessionId, { updatePath: false });
    }
  }, [sessionId, studio]);

  return (
    <PlaygroundPage
      agents={studio.agents}
      allSessions={studio.sessions.allSessions}
      answeringQuestions={studio.answeringQuestions}
      attachments={studio.attachments}
      decidingApprovals={studio.decidingApprovals}
      hasMessages={studio.hasMessages}
      isStreaming={studio.isStreaming}
      workingStartedAt={studio.workingStartedAt}
      messages={studio.messages}
      prompt={studio.prompt}
      runState={studio.runState}
      selectedAgent={studio.selectedAgent}
      selectedAgentId={studio.selectedAgentId}
      selectedAgentModels={studio.selectedAgentModels}
      selectedAgentQuickPrompts={studio.selectedAgentQuickPrompts}
      selectedModelRef={studio.selectedModelRef}
      selectedSessionId={studio.sessions.selectedSessionId}
      sessionLogs={studio.sessions.sessionLogs}
      sessionTraceSummaries={studio.sessionTraceSummaries}
      attachmentInputRef={studio.attachmentInputRef}
      promptRef={studio.promptRef}
      transcriptScrollerRef={studio.transcriptScrollerRef}
      onAddPromptAttachments={studio.addPromptAttachments}
      onApprovalDecision={studio.decideToolApproval}
      onDeleteSession={studio.setDeleteCandidate}
      onLoadSession={(sessionId) => void studio.sessions.loadSession(sessionId)}
      onOpenTrace={studio.traces.selectTrace}
      onPromptChange={studio.updatePrompt}
      onPromptKeyDown={studio.handlePromptKeyDown}
      onQuestionAnswer={studio.answerToolQuestion}
      onRemovePromptAttachment={studio.removePromptAttachment}
      onRunPrompt={studio.runPrompt}
      onStopPrompt={studio.stopPrompt}
      onSelectAgent={studio.selectPlaygroundAgent}
      onSelectModel={studio.setSelectedModelRef}
      onTranscriptScroll={studio.updateTranscriptStickiness}
    />
  );
}
