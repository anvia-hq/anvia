import { ArrowLeft, Bot, Cpu, GitBranch, Route, Wrench } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { StudioConfig, StudioTrace } from "../../../../types";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { ScrollArea } from "../../components/ui/scroll-area";
import { cn } from "../../lib/utils";
import {
  emptyFallback,
  formatDuration,
  formatToolValue,
  formatTraceDate,
  formatTraceTime,
  formatUsage,
  traceAgentLabel,
} from "../shared/format";
import { isRecord } from "../shared/object";
import { messageText } from "../shared/transcript";
import type { TraceInspectorKey, TraceLoadState, TraceObservationItem } from "../shared/types";

export function TraceBrowser(props: {
  agents: StudioConfig["agents"];
  traces: StudioTrace[];
  tracesEnabled: boolean;
  traceLoadState: TraceLoadState;
  selectedTraceId: string;
  traceSessionDetailId: string | undefined;
  onRefresh: () => void;
  onSelectTrace: (traceId: string) => void;
  onShowSessionTraces: (sessionId: string) => void;
}) {
  if (!props.tracesEnabled) {
    return (
      <div className="w-full rounded-sm border border-dashed border-border p-8 text-sm font-medium text-muted-foreground">
        Tracing is disabled
      </div>
    );
  }

  const selectedTrace =
    props.selectedTraceId.length === 0
      ? undefined
      : props.traces.find((trace) => trace.id === props.selectedTraceId);
  const selectedSessionTraces =
    selectedTrace === undefined || props.traceSessionDetailId !== selectedTrace.sessionId
      ? []
      : props.traces.filter((trace) => trace.sessionId === selectedTrace.sessionId);

  return (
    <section className="grid h-full min-h-0 w-full content-stretch" aria-label="Tracing">
      {props.selectedTraceId.length === 0 ? (
        <TraceTable
          agents={props.agents}
          traces={props.traces}
          traceLoadState={props.traceLoadState}
          onSelectTrace={props.onSelectTrace}
        />
      ) : (
        <TraceDetailRoute
          selectedTrace={selectedTrace}
          selectedSessionTraces={selectedSessionTraces}
          selectedTraceId={props.selectedTraceId}
          traceLoadState={props.traceLoadState}
          onBack={() => props.onSelectTrace("")}
          onShowSessionTraces={props.onShowSessionTraces}
        />
      )}
    </section>
  );
}

function TraceTable(props: {
  agents: StudioConfig["agents"];
  traces: StudioTrace[];
  traceLoadState: TraceLoadState;
  onSelectTrace: (traceId: string) => void;
}) {
  return (
    <Card
      className="min-h-0 overflow-hidden rounded-none border-x-0 border-t-0 border-border/80 bg-card/80"
      aria-label="Traces"
    >
      <ScrollArea className="h-full min-h-0">
        <div className="min-w-280">
          <div className="sticky top-0 z-10 grid min-h-11 grid-cols-[minmax(220px,1.3fr)_150px_120px_120px_120px_120px_110px_90px] items-center gap-4 border-b border-border/80 bg-card/95 px-6 font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground backdrop-blur">
            <span>Trace</span>
            <span>Session</span>
            <span>Agent</span>
            <span>Status</span>
            <span>Started</span>
            <span>Duration</span>
            <span>First delta</span>
            <span>Events</span>
          </div>
          {props.traceLoadState === "loading" && props.traces.length === 0 ? (
            <div className="px-5 py-4 text-sm font-medium text-muted-foreground">
              Loading traces
            </div>
          ) : null}
          {props.traceLoadState === "idle" && props.traces.length === 0 ? (
            <div className="px-5 py-4 text-sm font-medium text-muted-foreground">
              No traces found
            </div>
          ) : null}
          {props.traces.map((trace) => (
            <Button
              className="grid h-auto min-h-14 w-full grid-cols-[minmax(220px,1.3fr)_150px_120px_120px_120px_120px_110px_90px] items-center justify-start gap-4 whitespace-normal rounded-none border-0 border-b border-border/75 bg-transparent px-6 py-2.5 text-left text-muted-foreground shadow-none transition duration-200 hover:bg-accent/70 hover:text-accent-foreground"
              type="button"
              variant="ghost"
              key={trace.id}
              onClick={() => props.onSelectTrace(trace.id)}
            >
              <span className="min-w-0 truncate font-mono text-xs font-medium text-muted-foreground">
                {trace.id}
              </span>
              <span className="min-w-0 truncate font-mono text-xs font-medium">
                {trace.sessionId}
              </span>
              <span className="min-w-0 truncate text-xs font-medium">
                {traceAgentLabel(props.agents, trace)}
              </span>
              <span className="flex min-w-0 items-center gap-2 text-xs font-medium capitalize">
                <span
                  className={cn("h-2.5 w-2.5 shrink-0 rounded-full", statusDotClass(trace.status))}
                />
                <span className="min-w-0 truncate">{trace.status}</span>
              </span>
              <span className="min-w-0 truncate text-xs font-medium">
                {formatTraceDate(trace.startedAt)}
              </span>
              <span className="min-w-0 truncate text-xs font-medium">
                {emptyFallback(formatDuration(trace.durationMs))}
              </span>
              <span className="min-w-0 truncate text-xs font-medium">
                {emptyFallback(formatDuration(firstDeltaMsFromObservations(trace.observations)))}
              </span>
              <span className="min-w-0 truncate text-xs font-medium tabular-nums">
                {trace.observationCount}
              </span>
            </Button>
          ))}
        </div>
      </ScrollArea>
    </Card>
  );
}

function TraceDetailRoute(props: {
  selectedTrace: StudioTrace | undefined;
  selectedSessionTraces: StudioTrace[];
  selectedTraceId: string;
  traceLoadState: TraceLoadState;
  onBack: () => void;
  onShowSessionTraces: (sessionId: string) => void;
}) {
  return (
    <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
      <header className="grid min-h-16 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 overflow-hidden border-b border-border/80 bg-card/70 px-6 py-3 shadow-sm">
        <Button
          aria-label="Back to traces"
          className="h-8 min-h-8 w-8 text-muted-foreground hover:text-foreground"
          size="icon"
          type="button"
          variant="ghost"
          onClick={props.onBack}
        >
          <ArrowLeft aria-hidden="true" />
        </Button>
        <div className="grid min-w-0 gap-1">
          <strong className="min-w-0 truncate text-sm font-semibold text-foreground">
            {props.selectedTrace?.name ?? "Trace detail"}
          </strong>
          <span className="flex min-w-0 items-center gap-2 overflow-hidden text-xs font-medium text-muted-foreground">
            {props.selectedTrace === undefined ? (
              props.traceLoadState === "loading" ? (
                "Loading trace"
              ) : (
                "Trace not found"
              )
            ) : (
              <>
                <span
                  className={cn(
                    "h-2 w-2 shrink-0 rounded-full",
                    statusDotClass(props.selectedTrace.status),
                  )}
                />
                <span className="shrink-0 capitalize">{props.selectedTrace.status}</span>
                <span className="shrink-0" aria-hidden="true">
                  /
                </span>
                <span className="min-w-0 flex-1 truncate">
                  Session{" "}
                  <span className="font-mono font-semibold">{props.selectedTrace.sessionId}</span>
                </span>
              </>
            )}
          </span>
        </div>
        <span className="hidden max-w-[42vw] truncate rounded-sm bg-muted px-2 py-1 font-mono text-xs font-medium text-muted-foreground md:block">
          {props.selectedTraceId}
        </span>
      </header>
      <div className="min-h-0 min-w-0 overflow-hidden">
        {props.selectedTrace === undefined ? (
          <Card className="grid h-full place-items-center rounded-sm border-border bg-card p-6 text-sm font-medium text-muted-foreground">
            {props.traceLoadState === "loading" ? "Loading trace" : "Trace not found"}
          </Card>
        ) : (
          <TracePanel
            traces={
              props.selectedSessionTraces.length > 0
                ? props.selectedSessionTraces
                : [props.selectedTrace]
            }
            onShowSessionTraces={props.onShowSessionTraces}
          />
        )}
      </div>
    </div>
  );
}

function TracePanel(props: {
  traces: StudioTrace[];
  onShowSessionTraces: (sessionId: string) => void;
}) {
  const orderedTraces = useMemo(
    () =>
      [...props.traces].sort(
        (left, right) => Date.parse(left.startedAt) - Date.parse(right.startedAt),
      ),
    [props.traces],
  );
  const firstTraceId = orderedTraces[0]?.id ?? "";
  const [activeTraceId, setActiveTraceId] = useState(firstTraceId);
  const [activeKey, setActiveKey] = useState<TraceInspectorKey>("trace");
  useEffect(() => {
    setActiveTraceId(firstTraceId);
    setActiveKey("trace");
  }, [firstTraceId]);

  const activeTrace = orderedTraces.find((trace) => trace.id === activeTraceId) ?? orderedTraces[0];
  const turns = activeTrace === undefined ? [] : traceTurns(activeTrace);
  const selectTimelineItem = (traceId: string, key: TraceInspectorKey) => {
    setActiveTraceId(traceId);
    setActiveKey(key);
  };

  if (activeTrace === undefined) {
    return (
      <section
        className="grid h-full min-h-0 w-full place-items-center text-sm font-medium text-muted-foreground"
        aria-label="Traces"
      >
        No trace selected
      </section>
    );
  }

  return (
    <section
      className="grid h-full min-h-0 w-full content-stretch overflow-hidden"
      aria-label="Traces"
    >
      <div className="grid h-full min-h-0 grid-cols-[320px_minmax(0,1fr)] overflow-hidden max-md:grid-cols-1">
        <nav
          className="grid min-h-0 auto-rows-min content-start overflow-auto border-r border-border/80 bg-card/35 max-md:max-h-80 max-md:border-b max-md:border-r-0"
          aria-label="Trace timeline"
        >
          <div className="sticky top-0 z-30 flex min-h-11 items-center justify-between border-b border-border/80 bg-card/90 px-5 text-xs font-medium text-muted-foreground backdrop-blur">
            <span>Search</span>
            <strong className="text-foreground">Timeline</strong>
          </div>
          {orderedTraces.map((trace) => {
            const traceActive = activeTrace.id === trace.id;
            const traceTurnItems = traceTurns(trace);
            return (
              <div className="contents" key={trace.id}>
                <TraceTreeRow
                  active={traceActive && activeKey === "trace"}
                  ancestorLevels={[]}
                  hasChildren={true}
                  isLastSibling={true}
                  level={0}
                  tone="trace"
                  title={trace.name ?? "support-ticket-summary"}
                  subtitle={formatDuration(trace.durationMs)}
                  onSelect={() => selectTimelineItem(trace.id, "trace")}
                />
                <TraceTreeRow
                  active={traceActive && activeKey === "agent"}
                  ancestorLevels={[]}
                  hasChildren={traceTurnItems.length > 0}
                  isLastSibling={true}
                  level={1}
                  tone="agent"
                  title="agent.run"
                  subtitle={formatDuration(trace.durationMs)}
                  onSelect={() => selectTimelineItem(trace.id, "agent")}
                />
                {traceTurnItems.map((turn) => (
                  <div className="contents" key={`${trace.id}:turn:${turn.turn}`}>
                    <TraceTreeRow
                      active={traceActive && activeKey === `turn:${turn.turn}`}
                      ancestorLevels={[]}
                      hasChildren={turn.observations.length > 0}
                      isLastSibling={turn.turn === traceTurnItems.at(-1)?.turn}
                      level={2}
                      tone="turn"
                      title={`turn.${turn.turn}`}
                      subtitle={formatDuration(turn.durationMs)}
                      onSelect={() => selectTimelineItem(trace.id, `turn:${turn.turn}`)}
                    />
                    <TraceObservationRows
                      activeKey={activeKey}
                      isLastTurn={turn.turn === traceTurnItems.at(-1)?.turn}
                      observations={turn.observations}
                      onSelect={(observationId) =>
                        selectTimelineItem(trace.id, `observation:${observationId}`)
                      }
                      traceActive={traceActive}
                    />
                  </div>
                ))}
              </div>
            );
          })}
        </nav>
        <TraceDetailPane
          trace={activeTrace}
          turns={turns}
          activeKey={activeKey}
          onShowSessionTraces={props.onShowSessionTraces}
        />
      </div>
    </section>
  );
}

function TraceTreeRow(props: {
  active: boolean;
  ancestorLevels: number[];
  hasChildren: boolean;
  isLastSibling: boolean;
  level: number;
  tone: "trace" | "agent" | "turn" | StudioTrace["observations"][number]["kind"];
  title: string;
  subtitle: string;
  onSelect: () => void;
}) {
  const levelOffset = 22;
  const baseLeft = 12;
  const iconSize = 20;
  const iconCenter = baseLeft + iconSize / 2;
  const lineTop = 18;
  const xForLevel = (level: number) => iconCenter + level * levelOffset;

  return (
    <Button
      className={cn(
        "relative grid h-auto min-h-0 w-full min-w-0 grid-cols-[20px_minmax(0,1fr)] items-start justify-start gap-2 whitespace-normal rounded-none border-0 bg-transparent px-3 py-2.5 text-left text-muted-foreground shadow-none transition duration-200 hover:bg-accent/70 hover:text-accent-foreground",
        props.active && "bg-primary/10 text-primary hover:bg-primary/10 hover:text-primary",
      )}
      type="button"
      variant="ghost"
      onClick={props.onSelect}
      style={{ paddingLeft: `${baseLeft + props.level * levelOffset}px` }}
    >
      {props.ancestorLevels.map((level) => (
        <span
          className="pointer-events-none absolute inset-y-0 w-px bg-muted-foreground/35"
          style={{ left: `${xForLevel(level)}px` }}
          aria-hidden="true"
          key={`ancestor-line-${level}`}
        />
      ))}
      {props.level > 0 ? (
        <>
          <span
            className="pointer-events-none absolute top-0 w-px bg-muted-foreground/35"
            style={{
              left: `${xForLevel(props.level - 1)}px`,
              height: `${lineTop}px`,
            }}
            aria-hidden="true"
          />
          {props.isLastSibling ? null : (
            <span
              className="pointer-events-none absolute bottom-0 w-px bg-muted-foreground/35"
              style={{
                left: `${xForLevel(props.level - 1)}px`,
                top: `${lineTop}px`,
              }}
              aria-hidden="true"
            />
          )}
          <span
            className="pointer-events-none absolute h-px bg-muted-foreground/35"
            style={{
              left: `${xForLevel(props.level - 1)}px`,
              top: `${lineTop}px`,
              width: `${levelOffset}px`,
            }}
            aria-hidden="true"
          />
        </>
      ) : null}
      {props.hasChildren ? (
        <span
          className="pointer-events-none absolute bottom-0 w-px bg-muted-foreground/35"
          style={{
            left: `${xForLevel(props.level)}px`,
            top: `${lineTop}px`,
          }}
          aria-hidden="true"
        />
      ) : null}
      <span
        className={cn(
          "relative z-10 grid h-5 w-5 place-items-center rounded-sm bg-transparent [&_svg]:h-3 [&_svg]:w-3 [&_svg]:opacity-100",
          traceToneIconClass(props.tone),
        )}
      >
        <TraceToneIcon tone={props.tone} />
      </span>
      <span className="grid min-w-0 gap-0.5">
        <strong className="min-w-0 truncate text-sm font-medium leading-5 text-current">
          {props.title}
        </strong>
        <span className="min-w-0 truncate text-xs font-medium text-muted-foreground">
          {props.subtitle}
        </span>
      </span>
    </Button>
  );
}

function TraceObservationRows(props: {
  activeKey: TraceInspectorKey;
  isLastTurn: boolean;
  observations: TraceObservationItem[];
  traceActive: boolean;
  onSelect: (observationId: string) => void;
}) {
  const roots = traceObservationTree(props.observations);
  return (
    <>
      {roots.map((node, index) => (
        <TraceObservationNodeRow
          activeKey={props.activeKey}
          ancestorLevels={props.isLastTurn ? [] : [1]}
          isLastSibling={index === roots.length - 1}
          key={node.observation.id}
          level={3}
          node={node}
          onSelect={props.onSelect}
          traceActive={props.traceActive}
        />
      ))}
    </>
  );
}

function TraceObservationNodeRow(props: {
  activeKey: TraceInspectorKey;
  ancestorLevels: number[];
  isLastSibling: boolean;
  level: number;
  node: TraceObservationNode;
  traceActive: boolean;
  onSelect: (observationId: string) => void;
}) {
  const usageText = observationUsageText(props.node.observation);
  const childAncestorLevels = props.isLastSibling
    ? props.ancestorLevels
    : [...props.ancestorLevels, props.level];
  return (
    <>
      <TraceTreeRow
        active={props.traceActive && props.activeKey === `observation:${props.node.observation.id}`}
        ancestorLevels={props.ancestorLevels}
        hasChildren={props.node.children.length > 0}
        isLastSibling={props.isLastSibling}
        level={props.level}
        tone={props.node.observation.kind}
        title={traceObservationLabel(props.node.observation)}
        subtitle={
          usageText.length > 0
            ? `${formatDuration(props.node.observation.durationMs)} · ${usageText}`
            : formatDuration(props.node.observation.durationMs)
        }
        onSelect={() => props.onSelect(props.node.observation.id)}
      />
      {props.node.children.map((child, index) => (
        <TraceObservationNodeRow
          activeKey={props.activeKey}
          ancestorLevels={childAncestorLevels}
          isLastSibling={index === props.node.children.length - 1}
          key={child.observation.id}
          level={props.level + 1}
          node={child}
          onSelect={props.onSelect}
          traceActive={props.traceActive}
        />
      ))}
    </>
  );
}

function TraceDetailPane(props: {
  trace: StudioTrace;
  turns: Array<{ turn: number; observations: TraceObservationItem[]; durationMs?: number }>;
  activeKey: TraceInspectorKey;
  onShowSessionTraces: (sessionId: string) => void;
}) {
  const selected = selectedTraceDetail(props.trace, props.turns, props.activeKey);
  return (
    <section
      className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-background"
      aria-label="Trace detail"
    >
      <header className="border-b border-border/80 bg-card/45 px-6 py-5">
        <div className="grid min-w-0 gap-5">
          <div className="flex min-w-0 items-start justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <span
                className={cn(
                  "grid h-8 w-8 shrink-0 place-items-center bg-primary text-primary-foreground [&_svg]:h-4 [&_svg]:w-4 [&_svg]:opacity-100",
                  selected.tone !== "trace" && "bg-muted text-foreground",
                  traceToneIconClass(selected.tone),
                )}
              >
                <TraceToneIcon tone={selected.tone} />
              </span>
              <div className="grid min-w-0 gap-1">
                <h2 className="m-0 min-w-0 truncate text-2xl font-semibold leading-none tracking-[-0.01em] text-foreground">
                  {selected.title}
                </h2>
                <div className="font-mono text-xs font-medium text-muted-foreground">
                  {selected.startedAt}
                </div>
              </div>
            </div>
            {selected.usage.length > 0 ? (
              <div className="shrink-0 font-mono text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                {selected.usage}
              </div>
            ) : null}
          </div>
          <div className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-px overflow-hidden border border-border/80 bg-border/80">
            <TraceMetric label="Duration" value={formatDuration(selected.durationMs)} />
            {selected.firstDeltaMs === undefined ? null : (
              <TraceMetric label="First delta" value={formatDuration(selected.firstDeltaMs)} />
            )}
            <button
              className="grid min-w-0 gap-1 bg-background px-4 py-3 text-left transition duration-200 hover:bg-accent hover:text-accent-foreground"
              type="button"
              onClick={() => props.onShowSessionTraces(props.trace.sessionId)}
            >
              <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Session
              </span>
              <span className="min-w-0 truncate font-mono text-sm font-semibold text-current">
                {props.trace.sessionId}
              </span>
            </button>
          </div>
        </div>
      </header>
      <div className="min-w-0 overflow-auto">
        <div className="grid min-w-0 max-w-6xl content-start gap-6 p-6">
          {selected.input === undefined ? null : (
            <TraceDataSection title="Input" value={selected.input} />
          )}
          {selected.output === undefined ? null : (
            <TraceDataSection title="Output" value={selected.output} tone="success" />
          )}
          {selected.error === undefined ? null : (
            <TraceDataSection title="Error" value={selected.error} tone="error" />
          )}
          <TraceDataSection title="Metadata" value={selected.metadata} compact />
        </div>
      </div>
    </section>
  );
}

function TraceMetric(props: { label: string; value: string }) {
  return (
    <div className="grid min-w-0 gap-1 bg-background px-4 py-3">
      <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {props.label}
      </span>
      <span className="min-w-0 truncate font-mono text-sm font-semibold text-foreground">
        {props.value}
      </span>
    </div>
  );
}

function TraceDataSection(props: {
  title: string;
  value: unknown;
  tone?: "success" | "error";
  compact?: boolean;
}) {
  const rows = plainTraceValue(props.title, props.value);
  return (
    <section className="grid min-w-0 gap-3">
      <div className="flex items-center gap-3">
        <h3 className="m-0 text-lg font-semibold leading-tight text-foreground">{props.title}</h3>
        <span className="h-px flex-1 bg-border/80" aria-hidden="true" />
      </div>
      <div className="grid min-w-0 gap-3">
        {rows.map((item) => (
          <article
            className={cn(
              "grid min-w-0 gap-3 bg-card/65 px-4 py-4",
              props.compact &&
                "grid-cols-[150px_minmax(0,1fr)] items-start gap-4 max-lg:grid-cols-1",
              props.tone === "success" && "bg-primary/[0.08]",
              props.tone === "error" && "bg-destructive/10",
            )}
            key={`${item.label}-${item.text}`}
          >
            <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              {item.label}
            </span>
            <p
              className={cn(
                "m-0 whitespace-pre-wrap text-[15px] leading-7 text-foreground [overflow-wrap:anywhere]",
                props.compact && "font-mono text-[13px] leading-6",
                props.tone === "success" && "text-primary",
                props.tone === "error" && "text-destructive",
              )}
            >
              {item.text}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}

function plainTraceValue(title: string, value: unknown): Array<{ label: string; text: string }> {
  const messageRows = plainTraceInput(value, title);
  if (messageRows.length > 0) {
    return messageRows;
  }
  if (!isRecord(value)) {
    return [{ label: title, text: plainTraceText(value) }];
  }

  const rows: Array<{ label: string; text: string }> = [];
  for (const [key, item] of Object.entries(value)) {
    const nestedMessages = plainTraceInput(item, key);
    if (nestedMessages.length > 0) {
      rows.push(...nestedMessages);
      continue;
    }
    rows.push({ label: traceLabelText(key), text: plainTraceText(item) });
  }
  return rows.length > 0 ? rows : [{ label: title, text: "Empty object" }];
}

function plainTraceInput(
  value: unknown,
  parentKey?: string,
): Array<{ label: string; text: string }> {
  if (typeof value === "string") {
    return [{ label: "Value", text: value }];
  }
  if (Array.isArray(value)) {
    return value
      .map((item, index) => ({
        label: traceArrayItemLabel(item, index, parentKey),
        text: messageText(item) || formatToolValue(item),
      }))
      .filter((item) => item.text.length > 0);
  }
  if (!isRecord(value)) {
    return [];
  }

  const chatHistory = Array.isArray(value.chatHistory) ? value.chatHistory : undefined;
  if (chatHistory !== undefined) {
    const rows = systemPromptRows(value);
    rows.push(...plainTraceInput(chatHistory, "chatHistory"));
    return rows;
  }

  if (Array.isArray(value.prompt)) {
    return plainTraceInput(value.prompt, "prompt");
  }

  const rows: Array<{ label: string; text: string }> = [];
  rows.push(...systemPromptRows(value));

  const history = Array.isArray(value.history) ? value.history : [];
  if (history.length > 0) {
    rows.push(...plainTraceInput(history, "history"));
  }

  const promptText = messageText(value.prompt);
  if (promptText.length > 0) {
    rows.push({ label: history.length > 0 ? "Current prompt" : "Prompt", text: promptText });
  }

  return rows;
}

function traceArrayItemLabel(item: unknown, index: number, parentKey: string | undefined): string {
  if (isRecord(item)) {
    const type = typeof item.type === "string" ? item.type : undefined;
    if (parentKey === "choice") {
      if (type === "text") {
        return "Assistant output";
      }
      if (type === "reasoning") {
        return "Reasoning";
      }
    }
    if (type === "reasoning") {
      return "Reasoning";
    }
    if (typeof item.role === "string") {
      return traceLabelText(item.role);
    }
    if (type !== undefined) {
      return traceLabelText(type);
    }
  }

  const prefix = parentKey === undefined ? "Item" : `${traceLabelText(parentKey)} item`;
  return `${prefix} ${index + 1}`;
}

function traceLabelText(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function systemPromptRows(value: Record<string, unknown>): Array<{ label: string; text: string }> {
  const instructions = value.instructions;
  if (typeof instructions !== "string" || instructions.trim().length === 0) {
    return [];
  }
  return [{ label: "System prompt", text: instructions }];
}

function plainTraceText(value: unknown): string {
  if (value === undefined) {
    return "undefined";
  }
  if (value === null) {
    return "null";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function traceTurns(trace: StudioTrace): Array<{
  turn: number;
  observations: TraceObservationItem[];
  durationMs?: number;
}> {
  const grouped = new Map<number, TraceObservationItem[]>();
  for (const observation of trace.observations) {
    const turn = Number.isFinite(observation.turn) ? observation.turn : grouped.size + 1;
    grouped.set(turn, [...(grouped.get(turn) ?? []), observation]);
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => left - right)
    .map(([turn, observations]) => ({
      turn,
      observations,
      durationMs: observations.reduce(
        (total, observation) => total + (observation.durationMs ?? 0),
        0,
      ),
    }));
}

type TraceObservationNode = {
  observation: TraceObservationItem;
  children: TraceObservationNode[];
};

function traceObservationTree(observations: TraceObservationItem[]): TraceObservationNode[] {
  const nodes = new Map<string, TraceObservationNode>();
  for (const observation of observations) {
    nodes.set(observation.id, { observation, children: [] });
  }

  const roots: TraceObservationNode[] = [];
  for (const observation of observations) {
    const node = nodes.get(observation.id);
    if (node === undefined) {
      continue;
    }
    const parentId = observation.parentObservationId;
    const parent = parentId === undefined ? undefined : nodes.get(parentId);
    if (parent === undefined) {
      roots.push(node);
    } else {
      parent.children.push(node);
    }
  }
  return roots;
}

function selectedTraceDetail(
  trace: StudioTrace,
  turns: Array<{ turn: number; observations: TraceObservationItem[]; durationMs?: number }>,
  activeKey: TraceInspectorKey,
): {
  title: string;
  tone: "trace" | "agent" | "turn" | StudioTrace["observations"][number]["kind"];
  startedAt: string;
  durationMs: number | undefined;
  firstDeltaMs: number | undefined;
  usage: string;
  input?: unknown;
  output?: unknown;
  error?: unknown;
  metadata: unknown;
} {
  if (activeKey === "agent") {
    return {
      title: "agent.run",
      tone: "agent",
      startedAt: formatTraceTime(trace.startedAt),
      durationMs: trace.durationMs,
      firstDeltaMs: firstDeltaMsFromObservations(trace.observations),
      usage: formatUsage(trace.usage),
      input: trace.input,
      output: trace.output,
      error: trace.error,
      metadata: trace.metadata ?? {},
    };
  }
  if (activeKey.startsWith("turn:")) {
    const turnNumber = Number(activeKey.slice("turn:".length));
    const turn = turns.find((item) => item.turn === turnNumber);
    return {
      title: `turn.${Number.isFinite(turnNumber) ? turnNumber : 1}`,
      tone: "turn",
      startedAt: formatTraceTime(turn?.observations[0]?.startedAt ?? trace.startedAt),
      durationMs: turn?.durationMs,
      firstDeltaMs: firstDeltaMsFromObservations(turn?.observations ?? []),
      usage: turnUsageText(turn?.observations ?? []),
      input: turn?.observations[0]?.input,
      output: turn?.observations.at(-1)?.output,
      metadata: {
        turn: turnNumber,
        observations: turn?.observations.length ?? 0,
      },
    };
  }
  if (activeKey.startsWith("observation:")) {
    const observationId = activeKey.slice("observation:".length);
    const observation = trace.observations.find((item) => item.id === observationId);
    if (observation !== undefined) {
      return {
        title: traceObservationLabel(observation),
        tone: observation.kind,
        startedAt: formatTraceTime(observation.startedAt),
        durationMs: observation.durationMs,
        firstDeltaMs: firstDeltaMsFromMetadata(observation.metadata),
        usage: observationUsageText(observation),
        input: observation.input,
        output: observation.output,
        error: observation.error,
        metadata: {
          status: observation.status,
          parentObservationId: observation.parentObservationId ?? null,
          turn: observation.turn,
          startedAt: observation.startedAt,
          endedAt: observation.endedAt ?? null,
          ...(observation.metadata ?? {}),
        },
      };
    }
  }
  return {
    title: trace.name ?? "support-ticket-summary",
    tone: "trace",
    startedAt: formatTraceTime(trace.startedAt),
    durationMs: trace.durationMs,
    firstDeltaMs: firstDeltaMsFromObservations(trace.observations),
    usage: formatUsage(trace.usage),
    input: trace.input,
    output: trace.output,
    error: trace.error,
    metadata: trace.metadata ?? {},
  };
}

function traceObservationLabel(observation: TraceObservationItem): string {
  if (observation.kind === "agent") {
    return observation.name;
  }
  return observation.kind === "tool" ? `tool.${observation.name}` : observation.name;
}

function firstDeltaMsFromObservations(observations: TraceObservationItem[]): number | undefined {
  for (const observation of observations) {
    const firstDeltaMs = firstDeltaMsFromMetadata(observation.metadata);
    if (firstDeltaMs !== undefined) {
      return firstDeltaMs;
    }
  }
  return undefined;
}

function firstDeltaMsFromMetadata(metadata: unknown): number | undefined {
  if (!isRecord(metadata) || typeof metadata.firstDeltaMs !== "number") {
    return undefined;
  }
  return metadata.firstDeltaMs;
}

function statusDotClass(status: StudioTrace["status"]): string {
  switch (status) {
    case "success":
      return "bg-primary";
    case "error":
      return "bg-destructive";
    case "running":
      return "bg-chart-2";
  }
}

function TraceToneIcon(props: {
  tone: "trace" | "agent" | "turn" | StudioTrace["observations"][number]["kind"];
}) {
  switch (props.tone) {
    case "trace":
      return <Route aria-hidden="true" />;
    case "agent":
      return <Bot aria-hidden="true" />;
    case "turn":
      return <GitBranch aria-hidden="true" />;
    case "generation":
      return <Cpu aria-hidden="true" />;
    case "tool":
      return <Wrench aria-hidden="true" />;
  }
}

function traceToneIconClass(
  tone: "trace" | "agent" | "turn" | StudioTrace["observations"][number]["kind"],
): string {
  switch (tone) {
    case "trace":
      return "bg-primary text-background";
    case "agent":
      return "bg-chart-2 text-background";
    case "turn":
      return "bg-chart-4 text-background";
    case "generation":
      return "bg-chart-1 text-background";
    case "tool":
      return "bg-chart-5 text-background";
  }
}

function observationUsageText(observation: TraceObservationItem): string {
  if (!isRecord(observation.output) || !isRecord(observation.output.usage)) {
    return "";
  }
  return formatUsageValue(observation.output.usage);
}

function turnUsageText(observations: TraceObservationItem[]): string {
  const totals = observations
    .map(observationUsageText)
    .filter((usage) => usage.length > 0)
    .join(" + ");
  return totals;
}

function formatUsageValue(value: Record<string, unknown>): string {
  const input = typeof value.inputTokens === "number" ? value.inputTokens : 0;
  const output = typeof value.outputTokens === "number" ? value.outputTokens : 0;
  const total = typeof value.totalTokens === "number" ? value.totalTokens : input + output;
  if (total === 0) {
    return "";
  }
  return `${input} -> ${output} (Σ ${total})`;
}
