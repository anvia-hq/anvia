import {
  Archive,
  ArrowUp,
  Browser as BrowserIcon,
  Paperclip,
  Stop,
  X,
} from "@phosphor-icons/react";
import {
  type ChangeEvent,
  type CSSProperties,
  type KeyboardEvent,
  type RefObject,
  useState,
} from "react";
import type {
  StudioConfig,
  StudioModelSummary,
  StudioSessionLogEntry,
  StudioSessionSummary,
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
import { StudioPageShell } from "../../components/ui/studio";
import { Textarea } from "../../components/ui/textarea";
import { cn } from "../../lib/utils";
import { StudioBrowserView } from "../sandboxes/browser-view";
import type { RunState, TranscriptEntry } from "../shared/types";
import type { BrowserWorkspace } from "./browser-workspace";
import { SmoothedTranscript } from "./smoothed-transcript";

const defaultControlValue = "__anvia_default__";
const explicitControlValuePrefix = "__anvia_option__";

export function PlaygroundPage(props: {
  agents: StudioConfig["agents"];
  allSessions: StudioSessionSummary[];
  answeringQuestions: Set<string>;
  attachments: PromptAttachment[];
  browserWorkspace: BrowserWorkspace | undefined;
  browserWorkspaceOpen: boolean;
  decidingApprovals: Set<string>;
  hasMessages: boolean;
  isStreaming: boolean;
  transcriptResetKey: string | number;
  messages: TranscriptEntry[];
  prompt: string;
  runState: RunState;
  selectedAgent: StudioConfig["agents"][number] | undefined;
  selectedAgentId: string;
  selectedAgentModels: StudioModelSummary[];
  selectedAgentQuickPrompts: string[];
  selectedModelRef: string;
  selectedControls: Record<string, string>;
  selectedSessionId: string;
  sessionLogs: StudioSessionLogEntry[];
  sessionTraceSummaries: StudioTraceSummary[];
  attachmentInputRef: RefObject<HTMLInputElement | null>;
  promptRef: RefObject<HTMLTextAreaElement | null>;
  transcriptScrollerRef: RefObject<HTMLElement | null>;
  onAddPromptAttachments: (event: ChangeEvent<HTMLInputElement>) => void;
  onApprovalDecision: (approvalId: string, approved: boolean) => void;
  onDeleteSession: (session: StudioSessionSummary) => void;
  onCloseBrowserWorkspace: () => void;
  onError: (error: unknown) => void;
  onLoadSession: (sessionId: string) => void;
  onOpenBrowserWorkspace: () => void;
  onOpenTrace: (traceId: string) => void;
  onPromptChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  onPromptKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onQuestionAnswer: (
    questionId: string,
    answers: Array<{ questionId: string; answer: string; choice?: string; custom?: boolean }>,
  ) => void;
  onRemovePromptAttachment: (id: string) => void;
  onRunPrompt: (prompt: string) => void;
  onStopPrompt: () => void;
  onSelectAgent: (agentId: string) => void;
  onSelectModel: (modelRef: string) => void;
  onSelectControl: (id: string, value: string | undefined) => void;
  onTranscriptScroll: () => void;
}) {
  const [browserPanelWidth, setBrowserPanelWidth] = useState(720);
  const activeBrowserWorkspace = props.browserWorkspaceOpen ? props.browserWorkspace : undefined;
  const browserPanelStyle =
    activeBrowserWorkspace === undefined
      ? undefined
      : ({
          "--studio-browser-panel-width": `${browserPanelWidth}px`,
          gridTemplateColumns:
            "minmax(0, 1fr) minmax(440px, min(var(--studio-browser-panel-width), 72vw))",
        } as CSSProperties);

  return (
    <StudioPageShell
      className={cn(
        activeBrowserWorkspace === undefined
          ? "grid-cols-[minmax(0,1fr)_minmax(0,460px)] max-xl:grid-cols-1"
          : undefined,
      )}
      style={browserPanelStyle}
    >
      <div className="grid min-h-0 min-w-0">
        <div className="grid h-full min-h-0 min-w-0 grid-rows-[minmax(0,1fr)_auto]">
          <section
            className="min-h-0 overflow-y-auto overflow-x-hidden px-4 py-4 [overflow-anchor:none] [scrollbar-gutter:stable]"
            ref={props.transcriptScrollerRef}
            onScroll={props.onTranscriptScroll}
          >
            <div
              className="mx-auto grid min-h-full w-full max-w-200 content-start items-start gap-5 pb-8 [&>[data-entry-kind=tool]+[data-entry-kind=tool]]:-mt-3"
              data-studio-transcript-content=""
            >
              {!props.hasMessages ? (
                <div className="grid min-h-96 place-items-center text-sm font-medium text-muted-foreground">
                  <div className="grid max-w-xl gap-4 text-center">
                    <div className="mx-auto h-px w-28 bg-muted" />
                    <h1 className="m-0 font-heading text-2xl font-medium tracking-tight text-foreground text-balance">
                      What should this agent work on?
                    </h1>
                    <p className="m-0 text-sm leading-6 text-muted-foreground text-pretty">
                      Choose a prompt below or write a task. Studio will stream the response, tool
                      calls, approvals, and trace data here.
                    </p>
                  </div>
                </div>
              ) : null}
              <SmoothedTranscript
                answeringQuestions={props.answeringQuestions}
                decidingApprovals={props.decidingApprovals}
                isStreaming={props.isStreaming}
                messages={props.messages}
                resetKey={props.transcriptResetKey}
                sessionLogs={props.sessionLogs}
                sessionTraceSummaries={props.sessionTraceSummaries}
                onApprovalDecision={props.onApprovalDecision}
                onOpenTrace={props.onOpenTrace}
                onQuestionAnswer={props.onQuestionAnswer}
              />
            </div>
          </section>
          <form
            className="grid gap-3 bg-background px-4 pb-4 pt-2"
            onSubmit={(event) => {
              event.preventDefault();
              props.onRunPrompt(props.prompt);
            }}
          >
            {props.hasMessages || props.selectedAgentQuickPrompts.length === 0 ? null : (
              <div className="mx-auto grid w-full max-w-200 grid-cols-3 gap-2 max-md:grid-cols-1">
                {props.selectedAgentQuickPrompts.map((quickPrompt) => (
                  <Button
                    className="h-auto min-h-16 justify-start whitespace-normal rounded-lg border border-hair bg-card px-3 py-2.5 text-left text-sm font-medium leading-5 text-foreground shadow-none hover:border-foreground hover:bg-transparent hover:text-foreground"
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
            <div className="mx-auto grid w-full max-w-200 gap-1.5 rounded-lg border border-hair bg-card p-1.5 backdrop-blur focus-within:outline-2 focus-within:outline-offset-3 focus-within:outline-ring">
              <Textarea
                className="min-h-9 min-w-0 resize-none rounded-lg border-0 bg-muted px-2.5 py-1.5 text-base leading-6 text-foreground shadow-none outline-none ring-0 placeholder:text-muted-foreground focus-visible:border-transparent focus-visible:ring-0 focus-visible:outline-none dark:bg-muted"
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
                      className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-hair bg-muted px-2 py-1 text-xs font-medium text-muted-foreground"
                      key={attachment.id}
                    >
                      <span className="min-w-0 truncate">
                        {attachment.kind === "image" ? "Image" : "Doc"} / {attachment.name}
                      </span>
                      <Button
                        aria-label={`Remove ${attachment.name}`}
                        className="h-5 min-h-5 w-5 rounded-md border-0 bg-transparent p-0 text-muted-foreground shadow-none hover:bg-transparent hover:text-foreground [&_svg]:h-3 [&_svg]:w-3"
                        size="icon"
                        type="button"
                        variant="ghost"
                        onClick={() => props.onRemovePromptAttachment(attachment.id)}
                      >
                        <StudioIcon icon={X} aria-hidden="true" />
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
                    className="size-9 min-h-9 rounded-lg border-border bg-transparent p-0 text-muted-foreground shadow-none hover:border-foreground hover:bg-transparent hover:text-foreground"
                    size="icon"
                    type="button"
                    variant="ghost"
                    disabled={props.runState === "running"}
                    onClick={() => props.attachmentInputRef.current?.click()}
                  >
                    <StudioIcon icon={Paperclip} aria-hidden="true" />
                  </Button>
                  {props.browserWorkspace === undefined || props.browserWorkspaceOpen ? null : (
                    <Button
                      aria-label="Open browser workspace"
                      className="h-9 min-h-9 gap-1.5 rounded-lg border-border bg-transparent px-2.5 text-xs text-muted-foreground shadow-none hover:border-foreground hover:bg-transparent hover:text-foreground"
                      type="button"
                      variant="ghost"
                      onClick={props.onOpenBrowserWorkspace}
                    >
                      <StudioIcon icon={BrowserIcon} aria-hidden="true" />
                      Browser
                    </Button>
                  )}
                </div>
                <div className="flex min-w-0 items-center gap-2">
                  {Object.entries(
                    props.selectedAgentModels.find((model) => model.ref === props.selectedModelRef)
                      ?.controls ?? {},
                  ).map(([id, control]) => (
                    <Select
                      key={id}
                      value={
                        props.selectedControls[id] === undefined
                          ? defaultControlValue
                          : `${explicitControlValuePrefix}${props.selectedControls[id]}`
                      }
                      onValueChange={(value) =>
                        props.onSelectControl(
                          id,
                          value === defaultControlValue
                            ? undefined
                            : value.slice(explicitControlValuePrefix.length),
                        )
                      }
                      disabled={props.runState === "running"}
                    >
                      <SelectTrigger
                        aria-label={control.label}
                        title={control.description}
                        className="flex h-8 min-h-8 w-auto max-w-44 gap-2 border-0 bg-transparent px-2 py-1 text-xs font-medium text-muted-foreground shadow-none hover:bg-transparent hover:text-foreground"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent align="end">
                        <SelectItem value={defaultControlValue}>
                          {control.label}: Default
                          {control.defaultValue === undefined ? "" : ` (${control.defaultValue})`}
                        </SelectItem>
                        {control.options.map((option) => (
                          <SelectItem value={`${explicitControlValuePrefix}${option}`} key={option}>
                            {control.label}: {option}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ))}
                  {props.selectedAgentModels.length === 0 ? null : (
                    <Select
                      value={props.selectedModelRef}
                      onValueChange={props.onSelectModel}
                      disabled={props.runState === "running"}
                    >
                      <SelectTrigger
                        aria-label="Select model"
                        className="flex h-8 min-h-8 w-auto max-w-44 gap-2 border-0 bg-transparent px-2 py-1 text-xs font-medium text-muted-foreground shadow-none hover:bg-transparent hover:text-foreground sm:max-w-72"
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
                        className="flex h-8 min-h-8 w-auto max-w-64 gap-2 border-0 bg-transparent px-2 py-1 text-xs font-medium text-muted-foreground shadow-none hover:bg-transparent hover:text-foreground"
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
                    aria-label={
                      props.isStreaming
                        ? "Stop generating"
                        : props.runState === "running"
                          ? "Running"
                          : "Send message"
                    }
                    className="size-9 min-h-9 rounded-lg"
                    size="icon"
                    type={props.isStreaming ? "button" : "submit"}
                    disabled={
                      !props.isStreaming &&
                      (props.runState === "running" || props.selectedAgentId.length === 0)
                    }
                    onClick={props.isStreaming ? props.onStopPrompt : undefined}
                  >
                    <StudioIcon
                      icon={props.isStreaming ? Stop : ArrowUp}
                      weight={props.isStreaming ? "fill" : "regular"}
                    />
                  </Button>
                </div>
              </div>
            </div>
          </form>
        </div>
      </div>
      {activeBrowserWorkspace === undefined ? (
        <PlaygroundSessionsPanel
          sessions={props.allSessions}
          selectedSessionId={props.selectedSessionId}
          runState={props.runState}
          onDeleteSession={props.onDeleteSession}
          onLoadSession={props.onLoadSession}
        />
      ) : (
        <PlaygroundBrowserPanel
          workspace={activeBrowserWorkspace}
          width={browserPanelWidth}
          onClose={props.onCloseBrowserWorkspace}
          onError={props.onError}
          onWidthChange={setBrowserPanelWidth}
        />
      )}
    </StudioPageShell>
  );
}

function PlaygroundBrowserPanel(props: {
  workspace: BrowserWorkspace;
  width: number;
  onClose: () => void;
  onError: (error: unknown) => void;
  onWidthChange: (width: number) => void;
}) {
  const resize = (clientX: number) => {
    const maximum = Math.max(440, Math.min(1_100, window.innerWidth * 0.72));
    props.onWidthChange(Math.round(Math.min(maximum, Math.max(440, window.innerWidth - clientX))));
  };

  return (
    <aside
      className="relative h-full min-h-0 min-w-0 overflow-hidden border-l border-border bg-background"
      aria-label="Browser workspace"
    >
      <hr
        aria-label="Resize browser workspace"
        aria-orientation="vertical"
        aria-valuemax={1100}
        aria-valuemin={440}
        aria-valuenow={props.width}
        className="absolute inset-y-0 -left-1 z-20 m-0 h-auto w-2 cursor-col-resize touch-none border-0 bg-transparent transition-colors hover:bg-action-muted focus-visible:bg-action-muted focus-visible:outline-none"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          props.onWidthChange(
            Math.min(1_100, Math.max(440, props.width + (event.key === "ArrowLeft" ? 24 : -24))),
          );
        }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          resize(event.clientX);
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) resize(event.clientX);
        }}
      />
      <StudioBrowserView
        className="border-0"
        sandboxRef={props.workspace.sandboxRef}
        view={props.workspace.view}
        onClose={props.onClose}
        onError={props.onError}
      />
    </aside>
  );
}

function PlaygroundSessionsPanel(props: {
  sessions: StudioSessionSummary[];
  selectedSessionId: string;
  runState: RunState;
  onDeleteSession: (session: StudioSessionSummary) => void;
  onLoadSession: (sessionId: string) => void;
}) {
  return (
    <aside
      className="grid h-full min-h-0 min-w-0 max-h-full overflow-hidden border-l border-sidebar-border bg-sidebar text-sidebar-foreground max-xl:hidden"
      aria-label="Sessions"
    >
      <nav
        className="grid min-h-0 content-start gap-0.5 overflow-auto px-3 py-3"
        aria-label="Sessions"
      >
        {props.sessions.map((session) => (
          <PlaygroundSessionRow
            session={session}
            active={session.id === props.selectedSessionId}
            disabled={props.runState === "running"}
            onDeleteSession={props.onDeleteSession}
            onLoadSession={props.onLoadSession}
            key={session.id}
          />
        ))}
      </nav>
    </aside>
  );
}

function PlaygroundSessionRow(props: {
  session: StudioSessionSummary;
  active: boolean;
  disabled: boolean;
  onDeleteSession: (session: StudioSessionSummary) => void;
  onLoadSession: (sessionId: string) => void;
}) {
  const title = props.session.title ?? "Untitled chat";
  return (
    <div className="group relative min-w-0">
      <Button
        className={cn(
          "h-9 min-h-9 w-full justify-start rounded-lg bg-transparent px-2.5 py-0.5 pr-9 text-base font-[450] tracking-[-0.006em] text-muted-foreground shadow-none transition duration-200 hover:bg-transparent hover:text-sidebar-accent-foreground active:translate-y-px",
          props.active &&
            "bg-sidebar-accent font-semibold text-sidebar-accent-foreground hover:bg-sidebar-accent",
        )}
        type="button"
        variant="ghost"
        disabled={props.disabled}
        onClick={() => props.onLoadSession(props.session.id)}
      >
        <span className="min-w-0 flex-1 truncate text-left">{title}</span>
      </Button>
      <Button
        aria-label={`Delete ${title}`}
        className="absolute right-1 top-1/2 hidden h-7 min-h-7 w-7 -translate-y-1/2 rounded-lg border-0 bg-transparent p-0 text-muted-foreground opacity-70 shadow-none hover:bg-transparent hover:text-destructive hover:opacity-100 group-hover:inline-flex group-focus-within:inline-flex [&_svg]:h-4 [&_svg]:w-4"
        size="icon"
        type="button"
        variant="ghost"
        disabled={props.disabled}
        onClick={() => props.onDeleteSession(props.session)}
      >
        <StudioIcon icon={Archive} aria-hidden="true" />
      </Button>
    </div>
  );
}
