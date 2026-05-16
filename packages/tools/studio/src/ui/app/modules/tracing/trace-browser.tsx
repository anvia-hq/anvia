import {
  ArrowBendUpLeft,
  ArrowLeft,
  CaretDown,
  CaretRight,
  ChatText,
  Cpu,
  GearSix,
  GitBranch,
  Path,
  Robot,
  Wrench,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import type { StudioConfig, StudioTrace } from "../../../../types";
import { Badge } from "../../components/ui/badge";
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
      <div className="w-full rounded-lg border border-dashed border-border p-8 text-sm font-medium text-muted-foreground">
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
    <section
      className="grid h-full min-h-0 w-full content-stretch pb-6 pl-0 pr-6"
      aria-label="Tracing"
    >
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
      className="min-h-0 overflow-hidden rounded-xl border-border/80 bg-card/80"
      aria-label="Traces"
    >
      <ScrollArea className="h-full min-h-0">
        <div className="grid min-w-280 gap-1 p-2">
          <div className="sticky top-0 z-10 grid min-h-11 grid-cols-[minmax(220px,1.3fr)_150px_120px_120px_120px_120px_110px_90px] items-center gap-4 rounded-lg border border-border/60 bg-card/95 px-4 font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground backdrop-blur">
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
              className="grid h-auto min-h-14 w-full grid-cols-[minmax(220px,1.3fr)_150px_120px_120px_120px_120px_110px_90px] items-center justify-start gap-4 whitespace-normal rounded-lg border border-transparent bg-transparent px-4 py-2.5 text-left text-muted-foreground shadow-none transition duration-200 hover:border-primary/20 hover:bg-accent/70 hover:text-accent-foreground"
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
                  className={cn("h-2.5 w-2.5 shrink-0 rounded-lg", statusDotClass(trace.status))}
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
    <div className="grid h-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] gap-2 overflow-hidden rounded-xl border border-border/80 bg-card/70 p-2 shadow-sm">
      <header className="grid min-h-16 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 overflow-hidden rounded-lg border border-border/60 bg-card/95 px-4 py-3">
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
                    "h-2 w-2 shrink-0 rounded-lg",
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
        <span className="hidden max-w-[42vw] truncate rounded-lg bg-muted px-2 py-1 font-mono text-xs font-medium text-muted-foreground md:block">
          {props.selectedTraceId}
        </span>
      </header>
      <div className="min-h-0 min-w-0 overflow-hidden">
        {props.selectedTrace === undefined ? (
          <Card className="grid h-full place-items-center rounded-lg border-border bg-card p-6 text-sm font-medium text-muted-foreground">
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
          className="grid min-h-0 auto-rows-min content-start overflow-auto border-r border-border/80 bg-card/35 pr-2 max-md:max-h-80 max-md:border-b max-md:border-r-0"
          aria-label="Trace timeline"
        >
          <div className="sticky top-0 z-30 flex min-h-11 items-center justify-between bg-card/90 py-0 pl-0 pr-5 text-xs font-medium text-muted-foreground backdrop-blur">
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
                  title={trace.name ?? "Agent"}
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
        "relative grid h-auto min-h-0 w-full min-w-0 grid-cols-[20px_minmax(0,1fr)] items-start justify-start gap-2 whitespace-normal rounded-lg border-0 bg-transparent px-3 py-2.5 text-left text-muted-foreground shadow-none transition duration-200 hover:bg-accent/70 hover:text-accent-foreground",
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
          "relative z-10 grid h-5 w-5 place-items-center rounded-lg bg-transparent [&_svg]:h-3 [&_svg]:w-3 [&_svg]:opacity-100",
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
      className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-card/70"
      aria-label="Trace detail"
    >
      <header className="border-b border-border/60 bg-card/70 px-6 py-5">
        <div className="grid min-w-0 gap-5">
          <div className="flex min-w-0 items-start justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <span
                className={cn(
                  "grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground [&_svg]:h-4 [&_svg]:w-4 [&_svg]:opacity-100",
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
          </div>
          <div className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2">
            <TraceMetric label="Duration" value={formatDuration(selected.durationMs)} />
            {selected.firstDeltaMs === undefined ? null : (
              <TraceMetric label="First delta" value={formatDuration(selected.firstDeltaMs)} />
            )}
            {selected.usage.length === 0 ? null : (
              <TraceMetric label="Usage" value={selected.usage} />
            )}
            <button
              className="grid min-w-0 gap-1 rounded-lg bg-card/85 px-4 py-3 text-left transition duration-200 hover:bg-accent hover:text-accent-foreground"
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
        <div className="grid min-w-0 content-start gap-6 p-6">
          {selected.input === undefined ? null : (
            <TraceDataSection title="Input" value={selected.input} />
          )}
          {selected.output === undefined ? null : (
            <TraceDataSection title="Output" value={selected.output} tone="success" />
          )}
          {selected.error === undefined ? null : (
            <TraceDataSection title="Error" value={selected.error} tone="error" />
          )}
          <TraceDataSection title="Metadata" value={selected.metadata} rawJson />
        </div>
      </div>
    </section>
  );
}

function TraceMetric(props: { label: string; value: string }) {
  return (
    <div className="grid min-w-0 gap-1 rounded-lg bg-card/85 px-4 py-3">
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
  rawJson?: boolean;
}) {
  const rows = plainTraceValue(props.title, props.value);
  return (
    <section className="grid min-w-0 gap-3">
      <div className="flex items-center gap-3">
        <h3 className="m-0 text-lg font-semibold leading-tight text-foreground">{props.title}</h3>
        <span className="h-px flex-1 bg-border/80" aria-hidden="true" />
      </div>
      {props.rawJson ? (
        <TraceJsonTree value={props.value} />
      ) : (
        <div className="grid min-w-0 gap-3">
          {rows.map((item) => (
            <article
              className={cn(
                "grid min-w-0 gap-3 rounded-lg bg-card/85 px-4 py-4",
                props.compact &&
                  "grid-cols-[150px_minmax(0,1fr)] items-start gap-4 max-lg:grid-cols-1",
              )}
              key={`${item.label}-${item.text}`}
            >
              <span className="flex min-w-0 items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                <TraceRowIcon label={item.label} />
                {item.label}
              </span>
              <TraceRowContent compact={props.compact} item={item} tone={props.tone} />
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function TraceRowContent(props: {
  compact?: boolean | undefined;
  item: { label: string; text: string };
  tone?: "success" | "error" | undefined;
}) {
  const historyItems = conversationHistoryItems(props.item);
  if (historyItems.length > 0) {
    return (
      <div className="grid min-w-0 gap-5">
        {historyItems.map((item) => (
          <div className="grid min-w-0 gap-2" key={`${item.index}-${item.role}-${item.text}`}>
            <div className="flex min-w-0 items-center gap-2">
              <span className="font-mono text-xs font-semibold tabular-nums text-muted-foreground">
                {item.index}
              </span>
              <Badge
                className={cn(
                  "px-1.5 py-0.5",
                  item.role === "User" && "border-chart-2/40 bg-chart-2/15 text-chart-2",
                  item.role === "Assistant" && "border-chart-1/40 bg-chart-1/15 text-chart-1",
                  item.role === "Tool" && "border-chart-5/40 bg-chart-5/15 text-chart-5",
                )}
              >
                {item.role}
              </Badge>
            </div>
            <p className="m-0 whitespace-pre-wrap text-[15px] leading-7 text-foreground [overflow-wrap:anywhere]">
              {item.text}
            </p>
          </div>
        ))}
      </div>
    );
  }

  return (
    <p
      className={cn(
        "m-0 whitespace-pre-wrap text-[15px] leading-7 text-foreground [overflow-wrap:anywhere]",
        props.compact && "font-mono text-[13px] leading-6",
        props.tone === "success" && !isNeutralTraceRow(props.item) && "text-primary",
        props.tone === "error" && "text-destructive",
      )}
    >
      {props.item.text}
    </p>
  );
}

function conversationHistoryItems(row: {
  label: string;
  text: string;
}): Array<{ index: string; role: string; text: string }> {
  if (!row.label.startsWith("Conversation history")) {
    return [];
  }
  return row.text
    .split("\n\n")
    .flatMap((block): Array<{ index: string; role: string; text: string }> => {
      const [heading, ...content] = block.split("\n");
      const match = /^(\d+)\.\s+(.+)$/.exec(heading ?? "");
      if (match === null) {
        return [];
      }
      return [
        {
          index: match[1] ?? "",
          role: match[2] ?? "Message",
          text: content.join("\n"),
        },
      ];
    });
}

export function rawTraceJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? "undefined";
  } catch {
    return String(value);
  }
}

function TraceJsonTree(props: { value: unknown }) {
  return (
    <div className="overflow-x-auto rounded-lg bg-card/85 px-4 py-4 font-mono text-[13px] leading-6 text-foreground">
      <JsonNode depth={0} path="$" value={props.value} />
    </div>
  );
}

const jsonIndentSize = 16;
const jsonDisclosureGutter = 20;

function JsonNode(props: {
  arrayIndex?: number | undefined;
  depth: number;
  path: string;
  propertyKey?: string | undefined;
  trailingComma?: boolean | undefined;
  value: unknown;
}) {
  if (isJsonBranch(props.value)) {
    return (
      <JsonBranch
        arrayIndex={props.arrayIndex}
        depth={props.depth}
        path={props.path}
        propertyKey={props.propertyKey}
        trailingComma={props.trailingComma}
        value={props.value}
      />
    );
  }

  return (
    <div
      className="min-w-max whitespace-pre"
      style={{ paddingLeft: `${jsonContentIndent(props.depth)}px` }}
    >
      <JsonNodeLabel arrayIndex={props.arrayIndex} propertyKey={props.propertyKey} />
      <JsonPrimitive value={props.value} />
      {props.trailingComma ? <span className="text-foreground">,</span> : null}
    </div>
  );
}

function JsonBranch(props: {
  arrayIndex?: number | undefined;
  depth: number;
  path: string;
  propertyKey?: string | undefined;
  trailingComma?: boolean | undefined;
  value: Record<string, unknown> | unknown[];
}) {
  const [open, setOpen] = useState(props.depth === 0);
  const arrayValue = Array.isArray(props.value) ? props.value : undefined;
  const entries =
    arrayValue === undefined
      ? Object.entries(props.value as Record<string, unknown>)
      : arrayValue.map((item, index): [string, unknown] => [String(index), item]);
  const opening = arrayValue === undefined ? "{" : "[";
  const closing = arrayValue === undefined ? "}" : "]";
  const collapsed = arrayValue === undefined ? "{…}" : "[…]";

  if (entries.length === 0) {
    return (
      <div
        className="min-w-max whitespace-pre"
        style={{ paddingLeft: `${jsonContentIndent(props.depth)}px` }}
      >
        <JsonNodeLabel arrayIndex={props.arrayIndex} propertyKey={props.propertyKey} />
        <span className="text-foreground">
          {opening}
          {closing}
          {props.trailingComma ? "," : ""}
        </span>
      </div>
    );
  }

  return (
    <div className="grid min-w-max">
      <button
        aria-expanded={open}
        className="grid min-w-max grid-cols-[16px_auto] items-center gap-1 rounded-lg py-0.5 pr-2 text-left transition duration-200 hover:bg-accent/45 hover:text-accent-foreground"
        onClick={() => setOpen((current) => !current)}
        style={{ paddingLeft: `${props.depth * jsonIndentSize}px` }}
        type="button"
      >
        <span className="grid h-4 w-4 place-items-center text-muted-foreground [&_svg]:h-3 [&_svg]:w-3">
          {open ? <CaretDown aria-hidden="true" /> : <CaretRight aria-hidden="true" />}
        </span>
        <span className="whitespace-pre">
          <JsonNodeLabel arrayIndex={props.arrayIndex} propertyKey={props.propertyKey} />
          {open ? (
            <span className="text-foreground">{opening}</span>
          ) : (
            <span className="text-muted-foreground">{collapsed}</span>
          )}
          {!open && props.trailingComma ? <span className="text-foreground">,</span> : null}
        </span>
      </button>
      {open ? (
        <>
          {entries.map(([key, value], index) => (
            <JsonNode
              arrayIndex={arrayValue === undefined ? undefined : Number(key)}
              depth={props.depth + 1}
              key={`${props.path}.${key}`}
              path={`${props.path}.${key}`}
              propertyKey={arrayValue === undefined ? key : undefined}
              trailingComma={index < entries.length - 1}
              value={value}
            />
          ))}
          <div
            className="min-w-max whitespace-pre text-foreground"
            style={{ paddingLeft: `${jsonContentIndent(props.depth)}px` }}
          >
            {closing}
            {props.trailingComma ? "," : ""}
          </div>
        </>
      ) : null}
    </div>
  );
}

function jsonContentIndent(depth: number): number {
  return depth * jsonIndentSize + jsonDisclosureGutter;
}

function JsonNodeLabel(props: {
  arrayIndex?: number | undefined;
  propertyKey?: string | undefined;
}) {
  if (props.propertyKey !== undefined) {
    return (
      <>
        <span className="text-chart-2">{JSON.stringify(props.propertyKey)}</span>
        <span className="text-foreground">: </span>
      </>
    );
  }
  if (props.arrayIndex !== undefined) {
    return (
      <>
        <span className="text-muted-foreground">[{props.arrayIndex}]</span>
        <span className="text-foreground"> </span>
      </>
    );
  }
  return null;
}

function JsonPrimitive(props: { value: unknown }) {
  if (typeof props.value === "string") {
    return <span className="text-primary">{JSON.stringify(props.value)}</span>;
  }
  if (typeof props.value === "number") {
    return <span className="text-chart-1">{String(props.value)}</span>;
  }
  if (typeof props.value === "boolean") {
    return <span className="text-chart-4">{String(props.value)}</span>;
  }
  if (props.value === null) {
    return <span className="text-muted-foreground">null</span>;
  }
  if (props.value === undefined) {
    return <span className="text-muted-foreground">undefined</span>;
  }
  return <span className="text-foreground">{rawTraceJson(props.value)}</span>;
}

function isJsonBranch(value: unknown): value is Record<string, unknown> | unknown[] {
  return Array.isArray(value) || isRecord(value);
}

export function jsonSyntaxTokens(
  json: string,
): Array<{ text: string; type: JsonTokenType; start: number }> {
  const tokenPattern =
    /("(?:\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*"(?=\s*:)|"(?:\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\btrue\b|\bfalse\b|\bnull\b)/g;
  const tokens: Array<{ text: string; type: JsonTokenType; start: number }> = [];
  let cursor = 0;
  for (const match of json.matchAll(tokenPattern)) {
    const text = match[0];
    const index = match.index ?? 0;
    if (index > cursor) {
      tokens.push({ text: json.slice(cursor, index), type: "plain", start: cursor });
    }
    tokens.push({
      text,
      type: jsonTokenType(text, json.slice(index + text.length)),
      start: index,
    });
    cursor = index + text.length;
  }
  if (cursor < json.length) {
    tokens.push({ text: json.slice(cursor), type: "plain", start: cursor });
  }
  return tokens;
}

type JsonTokenType = "plain" | "key" | "string" | "number" | "boolean" | "null";

function jsonTokenType(text: string, followingText: string): JsonTokenType {
  if (text.startsWith('"')) {
    return followingText.trimStart().startsWith(":") ? "key" : "string";
  }
  if (text === "true" || text === "false") {
    return "boolean";
  }
  if (text === "null") {
    return "null";
  }
  return "number";
}

function isNeutralTraceRow(row: { label: string }): boolean {
  return row.label === "Message Id";
}

function TraceRowIcon(props: { label: string }) {
  const className = "h-3.5 w-3.5 shrink-0";
  switch (props.label) {
    case "System prompt":
      return <GearSix aria-hidden="true" className={className} />;
    case "Prompt":
      return <ChatText aria-hidden="true" className={className} />;
    case "Output":
    case "Assistant output":
      return <ArrowBendUpLeft aria-hidden="true" className={className} />;
    default:
      return null;
  }
}

export function plainTraceValue(
  title: string,
  value: unknown,
): Array<{ label: string; text: string }> {
  if (title === "Output") {
    const outputRows = plainTraceOutput(value);
    if (outputRows.length > 0) {
      return outputRows;
    }
  }
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

function plainTraceOutput(value: unknown): Array<{ label: string; text: string }> {
  if (!isRecord(value)) {
    return [];
  }
  const rows: Array<{ label: string; text: string }> = [];
  const choiceRows = plainTraceInput(value.choice, "choice");
  rows.push(...choiceRows);
  if (typeof value.messageId === "string" && value.messageId.length > 0) {
    rows.push({ label: "Message Id", text: value.messageId });
  }
  return rows;
}

function plainTraceInput(
  value: unknown,
  parentKey?: string,
): Array<{ label: string; text: string }> {
  if (typeof value === "string" && parentKey === undefined) {
    return [{ label: "Value", text: value }];
  }
  if (Array.isArray(value)) {
    if (parentKey === "chatHistory") {
      return chatHistoryRows(value);
    }
    if (parentKey === "history") {
      return conversationHistoryRows(value);
    }
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

function chatHistoryRows(value: unknown[]): Array<{ label: string; text: string }> {
  const messages = value
    .map((item, index) => ({
      label: traceArrayItemLabel(item, index, "chatHistory"),
      text: messageText(item) || formatToolValue(item),
    }))
    .filter((item) => item.text.length > 0);
  const current = messages.at(-1);
  const history = messages.slice(0, -1);
  const rows: Array<{ label: string; text: string }> = [];
  if (history.length > 0) {
    rows.push({
      label: `Conversation history (${history.length})`,
      text: history.map((item, index) => `${index + 1}. ${item.label}\n${item.text}`).join("\n\n"),
    });
  }
  if (current !== undefined) {
    rows.push({
      label: history.length > 0 ? "Current prompt" : "Prompt",
      text: current.text,
    });
  }
  return rows;
}

function conversationHistoryRows(value: unknown[]): Array<{ label: string; text: string }> {
  const messages = value
    .map((item, index) => ({
      label: traceArrayItemLabel(item, index, "history"),
      text: messageText(item) || formatToolValue(item),
    }))
    .filter((item) => item.text.length > 0);
  if (messages.length === 0) {
    return [];
  }
  return [
    {
      label: `Conversation history (${messages.length})`,
      text: messages.map((item, index) => `${index + 1}. ${item.label}\n${item.text}`).join("\n\n"),
    },
  ];
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
      metadata: traceDetailMetadata(trace),
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
      metadata: turnDetailMetadata(turnNumber, turn?.observations ?? []),
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
        metadata: observationDetailMetadata(observation),
      };
    }
  }
  return {
    title: trace.name ?? "Agent",
    tone: "trace",
    startedAt: formatTraceTime(trace.startedAt),
    durationMs: trace.durationMs,
    firstDeltaMs: firstDeltaMsFromObservations(trace.observations),
    usage: formatUsage(trace.usage),
    input: trace.input,
    output: trace.output,
    error: trace.error,
    metadata: traceDetailMetadata(trace),
  };
}

function traceDetailMetadata(trace: StudioTrace): Record<string, unknown> {
  const metadata = isRecord(trace.metadata) ? trace.metadata : {};
  const traceGroup = compactTraceMetadata({
    status: trace.status,
    traceId: trace.trace?.traceId ?? trace.id,
    observationId: trace.trace?.observationId,
    sessionId: trace.sessionId,
    observationCount: trace.observationCount,
    messageCount: traceMessageCount(metadata.messages),
    startedAt: trace.startedAt,
    endedAt: trace.endedAt,
    durationMs: trace.durationMs,
  });
  return compactTraceMetadata({
    ...metadata,
    status: trace.status,
    traceId: trace.trace?.traceId ?? trace.id,
    observationId: trace.trace?.observationId,
    sessionId: trace.sessionId,
    observationCount: trace.observationCount,
    messageCount: traceMessageCount(metadata.messages),
    startedAt: trace.startedAt,
    endedAt: trace.endedAt,
    durationMs: trace.durationMs,
    trace: isRecord(metadata.trace) ? metadata.trace : traceGroup,
  });
}

function turnDetailMetadata(
  turn: number,
  observations: TraceObservationItem[],
): Record<string, unknown> {
  return compactTraceMetadata({
    turn,
    observationCount: observations.length,
    generationCount: observations.filter((observation) => observation.kind === "generation").length,
    toolCount: observations.filter((observation) => observation.kind === "tool").length,
    agentCount: observations.filter((observation) => observation.kind === "agent").length,
    firstDeltaMs: firstDeltaMsFromObservations(observations),
    status: observationStatusSummary(observations),
    startedAt: observations[0]?.startedAt,
    endedAt: observations.at(-1)?.endedAt,
  });
}

function observationDetailMetadata(observation: TraceObservationItem): Record<string, unknown> {
  const metadata = isRecord(observation.metadata) ? observation.metadata : {};
  const base = compactTraceMetadata({
    ...metadata,
    status: observation.status,
    kind: observation.kind,
    turn: observation.turn,
    parentObservationId: observation.parentObservationId ?? null,
    startedAt: observation.startedAt,
    endedAt: observation.endedAt ?? null,
    durationMs: observation.durationMs,
  });
  return compactTraceMetadata({
    ...base,
    trace: isRecord(base.trace)
      ? base.trace
      : compactTraceMetadata({
          status: observation.status,
          kind: observation.kind,
          turn: observation.turn,
          parentObservationId: observation.parentObservationId ?? null,
          startedAt: observation.startedAt,
          endedAt: observation.endedAt ?? null,
          durationMs: observation.durationMs,
        }),
    modelInfo: isRecord(base.modelInfo) ? base.modelInfo : modelInfoMetadata(base),
    modelCall: isRecord(base.modelCall) ? base.modelCall : modelCallMetadata(base),
    response: isRecord(base.response) ? base.response : responseMetadata(base),
    tools: isRecord(base.tools) ? base.tools : toolsMetadata(base),
    timing: isRecord(base.timing) ? base.timing : timingMetadata(base),
  });
}

function modelInfoMetadata(metadata: Record<string, unknown>): Record<string, unknown> | undefined {
  const group = compactTraceMetadata({
    provider: metadata.provider,
    model: metadata.model,
    requestedModel: metadata.requestedModel,
    defaultModel: metadata.defaultModel,
  });
  return Object.keys(group).length === 0 ? undefined : group;
}

function modelCallMetadata(metadata: Record<string, unknown>): Record<string, unknown> | undefined {
  const request = compactTraceMetadata({
    messageCount: metadata.historyCount,
    documentCount: metadata.documentCount,
    toolCount: metadata.toolCount,
    toolNames: metadata.toolNames,
    temperature: metadata.temperature,
    maxTokens: metadata.maxTokens,
    toolChoice: metadata.toolChoice,
    hasOutputSchema: metadata.hasOutputSchema,
    additionalParamKeys: metadata.additionalParamKeys,
  });
  const group = compactTraceMetadata({
    request: Object.keys(request).length === 0 ? undefined : request,
    providerRequest: metadata.providerRequest,
  });
  return Object.keys(group).length === 0 ? undefined : group;
}

function responseMetadata(metadata: Record<string, unknown>): Record<string, unknown> | undefined {
  const group = compactTraceMetadata({
    messageId: metadata.messageId,
    usage: metadata.usage,
    providerResponse: metadata.providerResponse,
  });
  return Object.keys(group).length === 0 ? undefined : group;
}

function toolsMetadata(metadata: Record<string, unknown>): Record<string, unknown> | undefined {
  const group = compactTraceMetadata({
    count: metadata.toolCount,
    names: metadata.toolNames,
    toolChoice: metadata.toolChoice,
    internalCallId: metadata.internalCallId,
    toolCallId: metadata.toolCallId,
    skipped: metadata.skipped,
    description: metadata.toolDescription,
    parameterKeys: metadata.parameterKeys,
    requiredParameterKeys: metadata.requiredParameterKeys,
    approvalRequired: metadata.approvalRequired,
    mcpServerName: metadata.mcpServerName,
    argumentBytes: metadata.argumentBytes,
    resultBytes: metadata.resultBytes,
  });
  return Object.keys(group).length === 0 ? undefined : group;
}

function timingMetadata(metadata: Record<string, unknown>): Record<string, unknown> | undefined {
  const group = compactTraceMetadata({
    firstDeltaMs: metadata.firstDeltaMs,
    durationMs: metadata.durationMs,
    startedAt: metadata.startedAt,
    endedAt: metadata.endedAt,
  });
  return Object.keys(group).length === 0 ? undefined : group;
}

function observationStatusSummary(observations: TraceObservationItem[]): string {
  if (observations.length === 0) {
    return "empty";
  }
  if (observations.some((observation) => observation.status === "error")) {
    return "error";
  }
  if (observations.some((observation) => observation.status === "running")) {
    return "running";
  }
  return "success";
}

function traceMessageCount(value: unknown): number | undefined {
  return Array.isArray(value) ? value.length : undefined;
}

function compactTraceMetadata(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined));
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
      return <Path aria-hidden="true" />;
    case "agent":
      return <Robot aria-hidden="true" />;
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
