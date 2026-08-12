import { useSmoothStreamItems } from "@anvia/react";
import { lazy, Suspense, useMemo } from "react";
import type { StudioSessionLogEntry, StudioTraceSummary } from "../../../../types";
import type { TranscriptEntry } from "../shared/types";
import { assistantResponseMetricsByEntryId } from "./response-metrics";
import { hasTerminalTranscriptError, transcriptStreamAdapter } from "./transcript-stream";

const TranscriptItem = lazy(() =>
  import("./transcript-item").then((module) => ({
    default: module.TranscriptItem,
  })),
);

export function SmoothedTranscript(props: {
  answeringQuestions: Set<string>;
  decidingApprovals: Set<string>;
  isStreaming: boolean;
  messages: TranscriptEntry[];
  resetKey: string | number;
  sessionLogs: StudioSessionLogEntry[];
  sessionTraceSummaries: StudioTraceSummary[];
  onApprovalDecision: (approvalId: string, approved: boolean) => void;
  onOpenTrace: (traceId: string) => void;
  onQuestionAnswer: (
    questionId: string,
    answers: Array<{ questionId: string; answer: string; choice?: string; custom?: boolean }>,
  ) => void;
}) {
  const smoothed = useSmoothStreamItems(props.messages, {
    adapter: transcriptStreamAdapter,
    flushImmediately: hasTerminalTranscriptError(props.messages),
    isStreaming: props.isStreaming,
    resetKey: props.resetKey,
  });
  const sourceEntriesById = useMemo(
    () => new Map(props.messages.map((entry) => [entry.entryId, entry])),
    [props.messages],
  );
  const responseMetricsByEntryId = useMemo(
    () =>
      assistantResponseMetricsByEntryId({
        entries: props.messages,
        traceSummaries: props.sessionTraceSummaries,
        logs: props.sessionLogs,
      }),
    [props.messages, props.sessionLogs, props.sessionTraceSummaries],
  );
  return (
    <Suspense fallback={null}>
      {smoothed.items.map((displayEntry) => {
        const sourceEntry = sourceEntriesById.get(displayEntry.entryId) ?? displayEntry;
        return (
          <TranscriptItem
            key={displayEntry.entryId}
            entry={sourceEntry}
            displayText={transcriptStreamAdapter.getText(displayEntry)}
            live={smoothed.liveItemKey === String(displayEntry.entryId)}
            metrics={responseMetricsByEntryId.get(displayEntry.entryId)}
            decidingApprovals={props.decidingApprovals}
            answeringQuestions={props.answeringQuestions}
            onApprovalDecision={props.onApprovalDecision}
            onQuestionAnswer={props.onQuestionAnswer}
            onOpenTrace={props.onOpenTrace}
          />
        );
      })}
    </Suspense>
  );
}
