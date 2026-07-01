import { ArrowUp02Icon, AttachmentIcon, Cancel01Icon } from "@hugeicons/core-free-icons";
import {
  type ChangeEvent,
  type KeyboardEvent,
  lazy,
  type RefObject,
  Suspense,
  useMemo,
} from "react";
import type {
  StudioConfig,
  StudioModelSummary,
  StudioSessionLogEntry,
  StudioTraceSummary,
} from "../../../../types";
import {
  modelSelectLabel,
  type PromptAttachment,
  supportedAttachmentTypes,
} from "../../app-helpers";
import { Button } from "../../components/ui/button";
import { StudioIcon } from "../../components/ui/icon";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { StudioPageShell, StudioSurface } from "../../components/ui/studio";
import { Textarea } from "../../components/ui/textarea";
import { SessionLogsPanel } from "../session-logs/session-logs-panel";
import type { RunState, TranscriptEntry } from "../shared/types";
import { assistantResponseMetricsByEntryId } from "./response-metrics";

const TranscriptItem = lazy(() =>
  import("./transcript-item").then((module) => ({
    default: module.TranscriptItem,
  })),
);

export function PlaygroundPage(props: {
  agents: StudioConfig["agents"];
  answeringQuestions: Set<string>;
  attachments: PromptAttachment[];
  decidingApprovals: Set<string>;
  hasMessages: boolean;
  messages: TranscriptEntry[];
  prompt: string;
  runState: RunState;
  selectedAgent: StudioConfig["agents"][number] | undefined;
  selectedAgentId: string;
  selectedAgentModels: StudioModelSummary[];
  selectedAgentQuickPrompts: string[];
  selectedModelRef: string;
  selectedSessionId: string;
  sessionLogLoadState: "idle" | "loading";
  sessionLogs: StudioSessionLogEntry[];
  sessionTraceSummaries: StudioTraceSummary[];
  attachmentInputRef: RefObject<HTMLInputElement | null>;
  promptRef: RefObject<HTMLTextAreaElement | null>;
  transcriptScrollerRef: RefObject<HTMLElement | null>;
  onAddPromptAttachments: (event: ChangeEvent<HTMLInputElement>) => void;
  onApprovalDecision: (approvalId: string, approved: boolean) => void;
  onOpenTrace: (traceId: string) => void;
  onPromptChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  onPromptKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onQuestionAnswer: (
    questionId: string,
    answers: Array<{ questionId: string; answer: string; choice?: string; custom?: boolean }>,
  ) => void;
  onRemovePromptAttachment: (id: string) => void;
  onRunPrompt: (prompt: string) => void;
  onSelectAgent: (agentId: string) => void;
  onSelectModel: (modelRef: string) => void;
  onTranscriptScroll: () => void;
}) {
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
    <StudioPageShell className="grid-cols-[minmax(0,1fr)_minmax(0,460px)] max-xl:grid-cols-1">
      <div className="grid min-h-0 min-w-0 pb-6 pr-6">
        <StudioSurface className="grid h-full grid-rows-[minmax(0,1fr)_auto] p-2">
          <section
            className="min-h-0 overflow-y-auto overflow-x-hidden px-4 py-4 [scrollbar-gutter:stable]"
            ref={props.transcriptScrollerRef}
            onScroll={props.onTranscriptScroll}
          >
            <div className="mx-auto grid min-h-full w-full max-w-235 content-start items-start gap-6 pb-8">
              {!props.hasMessages ? (
                <div className="grid min-h-96 place-items-center text-sm font-medium text-muted-foreground">
                  <div className="grid max-w-xl gap-4 text-center">
                    <div className="mx-auto h-px w-28 bg-muted/55" />
                    <h1 className="m-0 text-4xl font-semibold leading-tight text-foreground text-balance">
                      What should this agent work on?
                    </h1>
                    <p className="m-0 text-base leading-7 text-muted-foreground text-pretty">
                      Choose a prompt below or write a task. Studio will stream the response, tool
                      calls, approvals, and trace data here.
                    </p>
                  </div>
                </div>
              ) : null}
              <Suspense fallback={null}>
                {props.messages.map((message) => (
                  <TranscriptItem
                    key={message.entryId}
                    entry={message}
                    metrics={responseMetricsByEntryId.get(message.entryId)}
                    decidingApprovals={props.decidingApprovals}
                    answeringQuestions={props.answeringQuestions}
                    onApprovalDecision={props.onApprovalDecision}
                    onQuestionAnswer={props.onQuestionAnswer}
                    onOpenTrace={props.onOpenTrace}
                  />
                ))}
              </Suspense>
            </div>
          </section>
          <form
            className="grid gap-3 bg-gradient-to-t from-card via-card/95 to-card/0 px-4 pb-4 pt-2"
            onSubmit={(event) => {
              event.preventDefault();
              props.onRunPrompt(props.prompt);
            }}
          >
            {props.hasMessages || props.selectedAgentQuickPrompts.length === 0 ? null : (
              <div className="mx-auto grid w-full max-w-235 grid-cols-3 gap-2 max-md:grid-cols-1">
                {props.selectedAgentQuickPrompts.map((quickPrompt) => (
                  <Button
                    className="h-auto min-h-16 justify-start whitespace-normal rounded-lg border border-border/80 bg-card/85 px-3 py-2.5 text-left text-sm font-medium leading-5 text-foreground shadow-sm hover:border-border/80 hover:bg-muted/45 hover:text-foreground"
                    type="button"
                    variant="ghost"
                    disabled={props.runState === "running" || props.selectedAgentId.length === 0}
                    onClick={() => props.onRunPrompt(quickPrompt)}
                    key={quickPrompt}
                  >
                    <span className="min-w-0 whitespace-normal wrap-break-words">
                      {quickPrompt}
                    </span>
                  </Button>
                ))}
              </div>
            )}
            <div className="mx-auto grid w-full max-w-235 gap-2 rounded-xl border border-border/80 bg-card/95 p-2.5 backdrop-blur">
              <Textarea
                className="min-h-16 min-w-0 resize-none rounded-lg border-0 bg-transparent px-3 py-3 text-base leading-7 text-foreground shadow-none outline-none ring-0 placeholder:text-muted-foreground/70 focus:border-transparent focus:ring-0"
                ref={props.promptRef}
                rows={1}
                value={props.prompt}
                onChange={props.onPromptChange}
                onKeyDown={props.onPromptKeyDown}
                placeholder="Ask anything..."
              />
              {props.attachments.length === 0 ? null : (
                <div className="flex min-w-0 flex-wrap gap-1.5 px-2">
                  {props.attachments.map((attachment) => (
                    <span
                      className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-border/80 bg-muted/55 px-2 py-1 text-xs font-medium text-muted-foreground"
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
                        onClick={() => props.onRemovePromptAttachment(attachment.id)}
                      >
                        <StudioIcon icon={Cancel01Icon} aria-hidden="true" />
                      </Button>
                    </span>
                  ))}
                </div>
              )}
              <div className="flex min-w-0 items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <input
                    ref={props.attachmentInputRef}
                    className="hidden"
                    type="file"
                    multiple
                    accept={supportedAttachmentTypes}
                    onChange={props.onAddPromptAttachments}
                  />
                  <Button
                    aria-label="Attach image or document"
                    className="h-8 min-h-8 w-8 border-0 bg-transparent p-0 text-muted-foreground shadow-none hover:bg-accent hover:text-accent-foreground"
                    size="icon"
                    type="button"
                    variant="ghost"
                    disabled={props.runState === "running"}
                    onClick={() => props.attachmentInputRef.current?.click()}
                  >
                    <StudioIcon icon={AttachmentIcon} aria-hidden="true" />
                  </Button>
                </div>
                <div className="flex min-w-0 items-center gap-2">
                  {props.selectedAgentModels.length === 0 ? null : (
                    <Select
                      value={props.selectedModelRef}
                      onValueChange={props.onSelectModel}
                      disabled={props.runState === "running"}
                    >
                      <SelectTrigger
                        aria-label="Select model"
                        className="flex h-8 min-h-8 w-auto max-w-44 gap-2 border-0 bg-transparent px-2 py-1 text-xs font-medium text-muted-foreground shadow-none hover:bg-accent hover:text-accent-foreground sm:max-w-72"
                      >
                        <SelectValue placeholder="Model" />
                      </SelectTrigger>
                      <SelectContent align="end">
                        {props.selectedAgentModels.map((model) => (
                          <SelectItem value={model.ref} key={model.ref}>
                            {modelSelectLabel(model)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  {props.agents.length > 1 ? (
                    <Select
                      value={props.selectedAgent?.id ?? props.selectedAgentId}
                      onValueChange={props.onSelectAgent}
                      disabled={props.runState === "running"}
                    >
                      <SelectTrigger
                        aria-label="Select agent"
                        className="flex h-8 min-h-8 w-auto max-w-64 gap-2 border-0 bg-transparent px-2 py-1 text-xs font-medium text-muted-foreground shadow-none hover:bg-accent hover:text-accent-foreground"
                      >
                        <SelectValue placeholder="Agent" />
                      </SelectTrigger>
                      <SelectContent align="end">
                        {props.agents.map((agent) => (
                          <SelectItem value={agent.id} key={agent.id}>
                            {agent.name ?? agent.id}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : null}
                  <Button
                    aria-label={props.runState === "running" ? "Running" : "Send message"}
                    className="h-9 min-h-9 w-9 rounded-full border-white bg-white text-black hover:bg-white/90"
                    size="icon"
                    type="submit"
                    disabled={props.runState === "running" || props.selectedAgentId.length === 0}
                  >
                    <StudioIcon icon={ArrowUp02Icon} />
                  </Button>
                </div>
              </div>
            </div>
          </form>
        </StudioSurface>
      </div>
      <SessionLogsPanel
        logs={props.sessionLogs}
        selectedSessionId={props.selectedSessionId}
        loading={props.sessionLogLoadState === "loading"}
      />
    </StudioPageShell>
  );
}
