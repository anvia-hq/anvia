import { useSmoothStreamItems } from "@anvia/react";
import { lazy, Suspense, useEffect, useMemo, useRef } from "react";
import type { StudioSessionLogEntry, StudioTraceSummary } from "../../../../types";
import type { TranscriptEntry } from "../shared/types";
import { assistantResponseMetricsByEntryId } from "./response-metrics";
import {
  currentTurnAssistantEntryId,
  hasTerminalTranscriptError,
  transcriptStreamAdapter,
} from "./transcript-stream";
import { WorkingDuration } from "./working-duration";

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
  workingStartedAt?: number | undefined;
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
  const retainedWorkingStartedAtRef = useRef(props.workingStartedAt);
  if (props.workingStartedAt !== undefined) {
    retainedWorkingStartedAtRef.current = props.workingStartedAt;
  }
  const visibleWorkingStartedAt =
    props.workingStartedAt ??
    (smoothed.isDraining ? retainedWorkingStartedAtRef.current : undefined);
  const workingResponseEntryId =
    visibleWorkingStartedAt === undefined ? undefined : currentTurnAssistantEntryId(props.messages);
  const visibleWorkingResponseEntryId = smoothed.items.some(
    (entry) => entry.entryId === workingResponseEntryId,
  )
    ? workingResponseEntryId
    : undefined;

  useEffect(() => {
    if (!smoothed.isDraining && props.workingStartedAt === undefined) {
      retainedWorkingStartedAtRef.current = undefined;
    }
  }, [props.workingStartedAt, smoothed.isDraining]);

  return (
    <>
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
              workingStartedAt={
                displayEntry.entryId === visibleWorkingResponseEntryId
                  ? visibleWorkingStartedAt
                  : undefined
              }
              decidingApprovals={props.decidingApprovals}
              answeringQuestions={props.answeringQuestions}
              onApprovalDecision={props.onApprovalDecision}
              onQuestionAnswer={props.onQuestionAnswer}
              onOpenTrace={props.onOpenTrace}
            />
          );
        })}
      </Suspense>
      {visibleWorkingStartedAt !== undefined && visibleWorkingResponseEntryId === undefined ? (
        <article className="max-w-[min(82ch,100%)] justify-self-start text-foreground">
          <WorkingDuration startedAt={visibleWorkingStartedAt} />
        </article>
      ) : null}
    </>
  );
}
