import { PathIcon, Wrench01Icon } from "@hugeicons/core-free-icons";
import { useState } from "react";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { StudioIcon } from "../../components/ui/icon";
import { Textarea } from "../../components/ui/textarea";
import { cn } from "../../lib/utils";
import { approvalLabel } from "../shared/format";
import { MarkdownText, ToolPayload } from "../shared/renderers";
import type { ToolApproval, ToolMessage, ToolQuestion, TranscriptEntry } from "../shared/types";

export function TranscriptItem(props: {
  entry: TranscriptEntry;
  decidingApprovals: Set<string>;
  answeringQuestions: Set<string>;
  onApprovalDecision: (approvalId: string, approved: boolean) => void;
  onQuestionAnswer: (
    questionId: string,
    answers: Array<{ questionId: string; answer: string; choice?: string; custom?: boolean }>,
  ) => void;
  onOpenTrace: (traceId: string) => void;
}) {
  if (props.entry.kind === "reasoning") {
    return (
      <article
        className="max-w-205 justify-self-start text-muted-foreground"
        data-entry-id={String(props.entry.entryId)}
      >
        <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Reasoning</div>
        <MarkdownText size="base" text={props.entry.text} />
      </article>
    );
  }

  if (props.entry.kind === "tool") {
    return (
      <ToolEntry
        entry={props.entry}
        decidingApprovals={props.decidingApprovals}
        answeringQuestions={props.answeringQuestions}
        onApprovalDecision={props.onApprovalDecision}
        onQuestionAnswer={props.onQuestionAnswer}
      />
    );
  }

  const traceId = props.entry.role === "assistant" ? props.entry.traceId : undefined;
  const hasTable = props.entry.role === "assistant" && hasMarkdownTable(props.entry.text);
  const isError =
    props.entry.role === "assistant" && "tone" in props.entry && props.entry.tone === "error";
  const isPending =
    props.entry.role === "assistant" && "tone" in props.entry && props.entry.tone === "pending";

  if (props.entry.role === "user") {
    return (
      <article
        className="grid w-fit max-w-[min(64ch,82%)] justify-items-end justify-self-end self-start text-foreground"
        data-entry-id={String(props.entry.entryId)}
      >
        {props.entry.text.trim().length === 0 ? null : (
          <div className="rounded-2xl bg-muted/55 px-4 py-2.5 shadow-sm shadow-black/[0.04] dark:bg-white/[0.08] dark:shadow-black/20">
            <MarkdownText size="base" text={props.entry.text} />
          </div>
        )}
        {props.entry.attachments !== undefined ? (
          <MessageAttachments attachments={props.entry.attachments} />
        ) : null}
      </article>
    );
  }

  return (
    <article
      className={cn(
        "self-start",
        hasTable ? "w-full max-w-full" : "max-w-[min(82ch,100%)]",
        props.entry.role === "assistant" &&
          cn("justify-self-start text-foreground", isError && "text-destructive"),
      )}
      data-entry-id={String(props.entry.entryId)}
    >
      {isPending ? <AssistantLoadingIndicator /> : null}
      {props.entry.text.trim().length === 0 ? null : (
        <MarkdownText size="base" text={props.entry.text} />
      )}
      {traceId !== undefined ? (
        <Button
          className="group mt-3 h-7 min-h-7 max-w-full gap-1.5 rounded-lg border border-border/80 bg-muted/35 px-2 py-1 text-xs font-semibold text-muted-foreground shadow-none transition duration-200 hover:border-border hover:bg-muted/55 hover:text-foreground"
          type="button"
          variant="ghost"
          onClick={() => props.onOpenTrace(traceId)}
        >
          <span className="grid h-4 w-4 shrink-0 place-items-center text-muted-foreground transition-colors group-hover:text-foreground [&_svg]:h-3 [&_svg]:w-3">
            <StudioIcon icon={PathIcon} aria-hidden="true" />
          </span>
          <span className="font-sans text-xs font-semibold uppercase tracking-[0.14em] text-foreground/90">
            Trace
          </span>
          <span className="h-4 w-px shrink-0 bg-border" aria-hidden="true" />
          <span className="min-w-0 truncate text-muted-foreground transition-colors group-hover:text-foreground">
            {traceId}
          </span>
        </Button>
      ) : null}
    </article>
  );
}

function AssistantLoadingIndicator() {
  return (
    <div
      aria-label="Assistant is responding"
      className="inline-flex h-9 min-h-9 items-center gap-2 rounded-xl border border-border/70 bg-muted/35 px-3 text-muted-foreground shadow-sm"
      role="status"
    >
      <span className="flex items-center gap-1" aria-hidden="true">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-foreground" />
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-foreground [animation-delay:150ms]" />
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-foreground [animation-delay:300ms]" />
      </span>
      <span className=" text-xs font-semibold uppercase text-muted-foreground">Thinking</span>
    </div>
  );
}

function MessageAttachments(props: {
  attachments: NonNullable<Extract<TranscriptEntry, { kind: "message" }>["attachments"]>;
}) {
  return (
    <div className="mt-2 flex max-w-full flex-wrap gap-2">
      {props.attachments.map((attachment, index) => {
        const key = `${attachment.kind}-${attachment.name ?? attachment.mediaType ?? index}-${index}`;
        if (attachment.kind === "image") {
          const src =
            attachment.url ??
            (attachment.data === undefined
              ? undefined
              : `data:${attachment.mediaType ?? "image/png"};base64,${attachment.data}`);
          return (
            <div
              className="overflow-hidden rounded-lg border border-border/80 bg-card/80"
              key={key}
            >
              {src === undefined ? (
                <div className="grid h-20 w-24 place-items-center px-2 text-center text-xs text-muted-foreground">
                  Image
                </div>
              ) : (
                <img
                  alt={attachment.name ?? "Attached image"}
                  className="h-20 w-24 object-cover"
                  src={src}
                />
              )}
            </div>
          );
        }
        return (
          <span
            className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-border/80 bg-card/80 px-2 py-1 text-xs font-medium text-muted-foreground"
            key={key}
          >
            <span className="min-w-0 truncate">
              {attachment.name ?? attachment.mediaType ?? "Document"}
            </span>
          </span>
        );
      })}
    </div>
  );
}

function hasMarkdownTable(text: string): boolean {
  const lines = text.split("\n");
  return lines.some((line, index) => {
    const next = lines[index + 1];
    return (
      line.includes("|") &&
      next !== undefined &&
      /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(next)
    );
  });
}

function ToolEntry(props: {
  entry: ToolMessage;
  decidingApprovals: Set<string>;
  answeringQuestions: Set<string>;
  onApprovalDecision: (approvalId: string, approved: boolean) => void;
  onQuestionAnswer: (
    questionId: string,
    answers: Array<{ questionId: string; answer: string; choice?: string; custom?: boolean }>,
  ) => void;
}) {
  const [collapsed, setCollapsed] = useState(
    props.entry.approval?.status !== "pending" && props.entry.question?.status !== "pending",
  );
  const approval = props.entry.approval;
  const question = props.entry.question;
  const childEvents = props.entry.childEvents ?? [];
  const hasPayload =
    props.entry.args !== undefined ||
    props.entry.result !== undefined ||
    childEvents.length > 0 ||
    approval !== undefined ||
    question !== undefined;
  const pendingApproval = approval?.status === "pending";
  const pendingQuestion = question?.status === "pending";
  const deciding = approval !== undefined && props.decidingApprovals.has(approval.id);
  const answering = question !== undefined && props.answeringQuestions.has(question.id);

  return (
    <article
      className="w-full justify-self-start overflow-hidden rounded-xl border border-border/80 bg-card/90 text-foreground shadow-sm shadow-black/20"
      data-entry-id={String(props.entry.entryId)}
    >
      <div
        className={cn(
          "flex min-w-0 items-center gap-2 px-3 py-2.5",
          !collapsed && hasPayload && "bg-muted/20",
        )}
      >
        <Button
          aria-expanded={!collapsed}
          className="h-auto min-h-0 min-w-0 flex-1 justify-between border-0 bg-transparent p-0 text-left text-inherit shadow-none hover:bg-transparent hover:text-inherit"
          type="button"
          variant="ghost"
          onClick={() => setCollapsed((current) => !current)}
        >
          <span className="flex min-w-0 items-center gap-2">
            <span className="grid h-6 w-4 shrink-0 place-items-center text-foreground">
              <StudioIcon icon={Wrench01Icon} className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
            <strong className="min-w-0 truncate text-sm font-semibold text-foreground">
              {props.entry.toolName}
            </strong>
          </span>
          {pendingApproval ? null : (
            <span className="ml-auto shrink-0 text-xs font-medium text-muted-foreground">
              {collapsed ? "Show" : "Hide"}
            </span>
          )}
        </Button>
        {pendingApproval && approval !== undefined ? (
          <ToolApprovalActions
            compact
            disabled={deciding}
            onDecision={(approved) => props.onApprovalDecision(approval.id, approved)}
          />
        ) : null}
        {pendingQuestion ? (
          <Badge className="border-border/70 bg-muted/45 px-1.5 py-0.5 text-xs uppercase text-foreground">
            Waiting for input
          </Badge>
        ) : null}
        {pendingApproval || pendingQuestion ? (
          <Button
            aria-expanded={!collapsed}
            className="h-7 min-h-7 px-2 text-xs font-medium"
            size="sm"
            type="button"
            variant="ghost"
            onClick={() => setCollapsed((current) => !current)}
          >
            {collapsed ? "Show" : "Hide"}
          </Button>
        ) : null}
      </div>
      {collapsed || !hasPayload ? null : (
        <div className="grid gap-3 p-3">
          {approval === undefined ? null : (
            <ToolApprovalPanel
              approval={approval}
              disabled={deciding}
              onDecision={(approved) => props.onApprovalDecision(approval.id, approved)}
            />
          )}
          {question === undefined ? null : (
            <ToolQuestionPanel
              disabled={answering}
              question={question}
              onAnswer={(answers) => props.onQuestionAnswer(question.id, answers)}
            />
          )}
          {question !== undefined || props.entry.args === undefined ? null : (
            <ToolPayload title="Input" value={props.entry.args} />
          )}
          {childEvents.length === 0 ? null : <ChildAgentActivity events={childEvents} />}
          {question !== undefined || props.entry.result === undefined ? null : (
            <ToolPayload title="Output" value={props.entry.result} />
          )}
        </div>
      )}
    </article>
  );
}

function ChildAgentActivity(props: { events: NonNullable<ToolMessage["childEvents"]> }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border/80 bg-background/65">
      <div className="bg-muted/20 px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        Subagent activity
      </div>
      <div className="grid gap-3 p-3">
        {props.events.map((event) => {
          const agentLabel = event.agentName ?? event.agentId;
          if (event.kind === "message" || event.kind === "reasoning") {
            return (
              <div
                className="grid gap-1 rounded-xl border border-border/80 bg-card/90 p-3"
                key={`${event.kind}-${event.agentId}-${event.text}`}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <Badge className="border-border bg-muted px-1.5 py-0.5 text-xs uppercase text-muted-foreground">
                    {event.kind === "reasoning" ? "Reasoning" : "Response"}
                  </Badge>
                  <span className="min-w-0 truncate text-xs font-semibold text-muted-foreground">
                    {agentLabel}
                  </span>
                </div>
                <MarkdownText size="base" text={event.text} />
              </div>
            );
          }
          return (
            <div
              className="grid gap-2 rounded-xl border border-border/80 bg-card/90 p-3"
              key={`${event.kind}-${event.agentId}-${event.toolName}-${event.callId ?? event.args ?? event.result ?? ""}`}
            >
              <div className="flex min-w-0 items-center gap-2">
                <Badge className="border-border/70 bg-muted/45 px-1.5 py-0.5 text-xs uppercase text-foreground">
                  Tool
                </Badge>
                <span className="min-w-0 truncate text-xs font-semibold text-muted-foreground">
                  {agentLabel} / {event.toolName}
                </span>
              </div>
              {event.args === undefined ? null : <ToolPayload title="Input" value={event.args} />}
              {event.result === undefined ? null : (
                <ToolPayload title="Output" value={event.result} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ToolQuestionPanel(props: {
  question: ToolQuestion;
  disabled: boolean;
  onAnswer: (
    answers: Array<{ questionId: string; answer: string; choice?: string; custom?: boolean }>,
  ) => void;
}) {
  const [values, setValues] = useState<Record<string, QuestionDraft>>({});
  const [activeQuestionIndex, setActiveQuestionIndex] = useState(0);
  const pending = props.question.status === "pending";
  const total = props.question.questions.length;

  const answers = props.question.questions.map((question) => {
    const draft = values[question.id];
    const customAnswer = draft?.customValue?.trim() ?? "";
    const answer = customAnswer.length > 0 ? customAnswer : draft?.answer;
    return {
      questionId: question.id,
      answer: answer?.trim() ?? "",
      ...(draft?.choice === undefined ? {} : { choice: draft.choice }),
      ...(customAnswer.length > 0 ? { custom: true } : {}),
    };
  });
  const activeIndex = total === 0 ? 0 : Math.min(activeQuestionIndex, total - 1);
  const activeQuestion = props.question.questions[activeIndex];
  const activeAnswer = answers[activeIndex]?.answer ?? "";
  const answeredCount = answers.filter((answer) => answer.answer.length > 0).length;
  const canAdvance = activeAnswer.length > 0;
  const canSubmit = pending && answers.every((answer) => answer.answer.length > 0);
  const firstQuestion = activeIndex === 0;
  const lastQuestion = activeIndex >= total - 1;

  if (activeQuestion === undefined) {
    return (
      <div className="rounded-xl border border-border bg-background p-4 text-sm font-medium text-muted-foreground">
        No questions
      </div>
    );
  }

  const goPrevious = () => setActiveQuestionIndex((current) => Math.max(0, current - 1));
  const goNext = () =>
    setActiveQuestionIndex((current) => Math.min(props.question.questions.length - 1, current + 1));
  const updateDraft = (questionId: string, value: QuestionDraft) =>
    setValues((current) => ({
      ...current,
      [questionId]: value,
    }));

  return (
    <div className="grid gap-3">
      <QuestionPromptControl
        key={activeQuestion.id}
        disabled={props.disabled || !pending}
        index={activeIndex}
        total={total}
        question={activeQuestion}
        value={values[activeQuestion.id]}
        answer={props.question.answers?.find((answer) => answer.questionId === activeQuestion.id)}
        onChange={(value) => updateDraft(activeQuestion.id, value)}
        {...(lastQuestion ? {} : { onAdvance: goNext })}
      />
      {pending ? (
        <div className="flex min-w-0 items-center justify-between gap-3 rounded-xl bg-muted/20 px-3 py-2">
          <div className="min-w-0 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            {answeredCount}/{total} answered
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {firstQuestion ? null : (
              <Button type="button" variant="secondary" onClick={goPrevious}>
                Back
              </Button>
            )}
            {lastQuestion ? (
              <Button
                className="h-9 min-h-9 px-4"
                disabled={props.disabled || !canSubmit}
                type="button"
                onClick={() => props.onAnswer(answers)}
              >
                Submit answers
              </Button>
            ) : (
              <Button
                className="h-9 min-h-9 px-4"
                disabled={props.disabled || !canAdvance}
                type="button"
                onClick={goNext}
              >
                Next question
              </Button>
            )}
          </div>
        </div>
      ) : total > 1 ? (
        <div className="flex min-w-0 items-center justify-between gap-3 rounded-xl bg-muted/20 px-3 py-2">
          <div className="min-w-0 text-xs font-semibold uppercase tracking-[0.2em] text-foreground">
            Answered
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button disabled={firstQuestion} type="button" variant="secondary" onClick={goPrevious}>
              Back
            </Button>
            <Button disabled={lastQuestion} type="button" variant="secondary" onClick={goNext}>
              Next
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

type QuestionDraft = {
  answer?: string;
  choice?: string;
  customValue?: string;
};

function QuestionPromptControl(props: {
  question: ToolQuestion["questions"][number];
  value: QuestionDraft | undefined;
  answer: NonNullable<ToolQuestion["answers"]>[number] | undefined;
  disabled: boolean;
  index: number;
  total: number;
  onChange: (value: QuestionDraft) => void;
  onAdvance?: () => void;
}) {
  const submittedAnswer = props.answer?.answer;
  const draftAnswer = questionDraftAnswer(props.value);
  const state =
    submittedAnswer !== undefined ? "Answered" : draftAnswer.length > 0 ? "Ready" : "Waiting";

  return (
    <section className="grid gap-4 rounded-xl border border-border/80 bg-background/70 p-4">
      <div className="flex min-w-0 items-start justify-between gap-4">
        <div className="grid min-w-0 gap-2">
          <div className=" text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Question {props.index + 1} of {props.total}
          </div>
          <h3 className="m-0 text-base font-semibold leading-7 text-foreground [overflow-wrap:anywhere]">
            {props.question.question}
          </h3>
        </div>
        <span
          className={cn(
            "shrink-0 text-xs font-semibold uppercase tracking-[0.18em]",
            state === "Answered" && "text-foreground",
            state === "Ready" && "text-foreground",
            state === "Waiting" && "text-muted-foreground",
          )}
        >
          {state}
        </span>
      </div>
      {submittedAnswer === undefined ? null : (
        <div className="rounded-lg border border-border/70 bg-muted/45 px-3 py-2 text-sm font-medium text-foreground">
          {submittedAnswer}
        </div>
      )}
      {submittedAnswer !== undefined ? null : props.question.choices.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {props.question.choices.map((choice) => {
            const active = props.value?.choice === choice.value;
            return (
              <Button
                key={choice.value}
                className={cn("h-8 min-h-8 px-3 text-xs", active && "border-foreground/45")}
                disabled={props.disabled}
                size="sm"
                type="button"
                variant={active ? "default" : "secondary"}
                onClick={() => {
                  props.onChange({
                    answer: choice.value,
                    choice: choice.value,
                    customValue: props.value?.customValue ?? "",
                  });
                  props.onAdvance?.();
                }}
              >
                {choice.label}
              </Button>
            );
          })}
        </div>
      ) : null}
      {submittedAnswer !== undefined ? null : (
        <Textarea
          className="min-h-24 text-sm"
          disabled={props.disabled}
          placeholder="Type a custom answer"
          rows={3}
          value={props.value?.customValue ?? ""}
          onChange={(event) =>
            props.onChange({
              ...props.value,
              customValue: event.currentTarget.value,
            })
          }
        />
      )}
    </section>
  );
}

function questionDraftAnswer(value: QuestionDraft | undefined): string {
  const customAnswer = value?.customValue?.trim() ?? "";
  return customAnswer.length > 0 ? customAnswer : (value?.answer?.trim() ?? "");
}

function ToolApprovalPanel(props: {
  approval: ToolApproval;
  disabled: boolean;
  onDecision: (approved: boolean) => void;
}) {
  const pending = props.approval.status === "pending";
  return (
    <div className="grid gap-3 rounded-xl border border-border/80 bg-muted/35 p-3">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase text-muted-foreground">Approval</div>
          <div className="mt-0.5 text-sm font-medium text-foreground">
            {approvalLabel(props.approval)}
          </div>
        </div>
        {pending ? (
          <ToolApprovalActions disabled={props.disabled} onDecision={props.onDecision} />
        ) : null}
      </div>
      {props.approval.reason === undefined ? null : (
        <div className="text-xs font-medium text-muted-foreground [overflow-wrap:anywhere]">
          {props.approval.reason}
        </div>
      )}
    </div>
  );
}

function ToolApprovalActions(props: {
  compact?: boolean;
  disabled: boolean;
  onDecision: (approved: boolean) => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2">
      <Button
        className={cn(props.compact ? "h-7 min-h-7 px-2 text-xs" : "h-8 min-h-8")}
        disabled={props.disabled}
        size="sm"
        type="button"
        onClick={() => props.onDecision(true)}
      >
        Approve
      </Button>
      <Button
        className={cn(props.compact ? "h-7 min-h-7 px-2 text-xs" : "h-8 min-h-8")}
        disabled={props.disabled}
        size="sm"
        type="button"
        variant="secondary"
        onClick={() => props.onDecision(false)}
      >
        Reject
      </Button>
    </div>
  );
}
