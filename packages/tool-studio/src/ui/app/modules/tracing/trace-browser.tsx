import {
  ArrowLeft,
  ArrowSquareOut,
  ArrowsOutLineVertical,
  BracketsCurly,
  CaretRight,
  Clock,
  MagnifyingGlass,
  Timer,
  TreeStructure,
} from "@phosphor-icons/react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
  firstDeltaMsFromObservations,
  isNeutralTraceRow,
  observationUsageText,
  plainTraceValue,
  selectedTraceDetail,
  statusDotClass,
  TraceJsonTree,
  type TraceObservationNode,
  TraceRowIcon,
  TraceToneIcon,
  traceObservationLabel,
  traceObservationTree,
  traceToneIconClass,
  traceTurns,
} from "./trace-browser-detail";

export {
  compactTraceMetadata,
  firstDeltaMsFromObservations,
  jsonSyntaxTokens,
  observationDetailMetadata,
  observationStatusSummary,
  observationUsageText,
  plainTraceValue,
  rawTraceJson,
  selectedTraceDetail,
  traceDetailMetadata,
  traceObservationLabel,
  traceObservationTree,
  traceTurns,
  turnUsageText,
} from "./trace-browser-detail";

import type { StudioConfig, StudioTrace } from "../../../../types";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { StudioIcon } from "../../components/ui/icon";
import { Input } from "../../components/ui/input";
import { ScrollArea } from "../../components/ui/scroll-area";
import { cn } from "../../lib/utils";
import {
  emptyFallback,
  formatDuration,
  formatTraceDate,
  formatUsage,
  traceAgentLabel,
} from "../shared/format";
import { isRecord } from "../shared/object";
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
      className="min-h-0 overflow-hidden rounded-none border-0 bg-background p-0"
      aria-label="Traces"
    >
      <ScrollArea className="h-full min-h-0">
        <div className="grid min-w-280">
          <div className="sticky top-0 z-10 grid min-h-11 grid-cols-[minmax(220px,1.3fr)_150px_120px_120px_120px_120px_110px_90px] items-center gap-4 border-b bg-background/95 px-4 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground backdrop-blur">
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
              className="grid h-auto min-h-14 w-full grid-cols-[minmax(220px,1.3fr)_150px_120px_120px_120px_120px_110px_90px] items-center justify-start gap-4 whitespace-normal rounded-none border-0 border-b bg-transparent px-4 py-2.5 text-left text-muted-foreground shadow-none transition duration-200 hover:bg-accent/70 hover:text-accent-foreground"
              type="button"
              variant="ghost"
              key={trace.id}
              onClick={() => props.onSelectTrace(trace.id)}
            >
              <span className="min-w-0 truncate text-xs font-medium text-muted-foreground">
                {trace.id}
              </span>
              <span className="min-w-0 truncate text-xs font-medium">{trace.sessionId}</span>
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
  const summaryTone = props.selectedTrace?.observations[0]?.kind ?? "trace";
  return (
    <div className="grid h-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-background">
      <header className="shrink-0 border-b bg-background px-4 py-3">
        <div className="flex min-w-0 items-start gap-3">
          <Button
            aria-label="Back to traces"
            className="mt-0.5 text-muted-foreground hover:text-foreground"
            size="icon"
            type="button"
            variant="ghost"
            onClick={props.onBack}
          >
            <StudioIcon icon={ArrowLeft} aria-hidden="true" />
          </Button>
          <span
            className={cn(
              "grid size-9 shrink-0 place-items-center rounded-lg [&_svg]:size-4",
              traceToneIconClass(summaryTone),
            )}
          >
            <TraceToneIcon tone={summaryTone} />
          </span>
          <div className="grid min-w-0 gap-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h1 className="truncate text-lg font-semibold tracking-tight">
                {traceDisplayName(props.selectedTrace)}
              </h1>
              {props.selectedTrace ? (
                <TraceStatusBadge status={props.selectedTrace.status} />
              ) : null}
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              {props.selectedTrace === undefined ? (
                props.traceLoadState === "loading" ? (
                  "Loading trace"
                ) : (
                  "Trace not found"
                )
              ) : (
                <>
                  <span>{formatTraceDate(props.selectedTrace.startedAt)}</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono" title={props.selectedTraceId}>
                    {props.selectedTraceId}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
        {props.selectedTrace ? (
          <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 border-t pt-3 sm:grid-cols-4">
            <HeaderMetric label="Duration" value={formatDuration(props.selectedTrace.durationMs)} />
            <HeaderMetric label="Spans" value={String(props.selectedTrace.observationCount)} />
            <HeaderMetric
              label="Tokens"
              value={emptyFallback(formatUsage(props.selectedTrace.usage))}
            />
            <HeaderMetric label="Session" value={props.selectedTrace.sessionId} mono />
          </dl>
        ) : null}
      </header>
      <div className="min-h-0 min-w-0 overflow-hidden">
        {props.selectedTrace === undefined ? (
          <Card className="grid h-full place-items-center rounded-none border-0 bg-background p-6 text-sm font-medium text-muted-foreground">
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

function traceDisplayName(trace: StudioTrace | undefined): string {
  if (trace?.name) return trace.name;
  if (isRecord(trace?.metadata) && typeof trace.metadata.agentName === "string") {
    return trace.metadata.agentName;
  }
  return "Trace detail";
}

function HeaderMetric(props: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid min-w-0 gap-1">
      <dt className="text-xs text-muted-foreground">{props.label}</dt>
      <dd className={cn("truncate text-sm font-medium tabular-nums", props.mono && "font-mono")}>
        {props.value}
      </dd>
    </div>
  );
}

function TraceStatusBadge({ status }: { status: string }) {
  return (
    <Badge
      className={cn(
        "border-0 capitalize",
        status === "success" &&
          "bg-emerald-200 text-emerald-950 dark:bg-emerald-300 dark:text-emerald-950",
        status === "error" && "bg-rose-200 text-rose-950 dark:bg-rose-300 dark:text-rose-950",
        status === "running" && "bg-amber-200 text-amber-950 dark:bg-amber-300 dark:text-amber-950",
        status !== "success" &&
          status !== "error" &&
          status !== "running" &&
          "bg-slate-200 text-slate-900 dark:bg-slate-300 dark:text-slate-950",
      )}
    >
      {status}
    </Badge>
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
  const [activeKey, setActiveKey] = useState<TraceInspectorKey>("agent");
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [search, setSearch] = useState("");
  useEffect(() => {
    setActiveTraceId(firstTraceId);
    setActiveKey("agent");
  }, [firstTraceId]);

  const activeTrace = orderedTraces.find((trace) => trace.id === activeTraceId) ?? orderedTraces[0];
  const turns = activeTrace === undefined ? [] : traceTurns(activeTrace);
  const selectTimelineItem = (traceId: string, key: TraceInspectorKey) => {
    setActiveTraceId(traceId);
    setActiveKey(key);
  };
  const query = search.trim().toLowerCase();
  const searchResults =
    query.length === 0
      ? []
      : orderedTraces.flatMap((trace) =>
          trace.observations
            .filter((observation) =>
              [observation.name, observation.kind, observation.id].some((value) =>
                value.toLowerCase().includes(query),
              ),
            )
            .map((observation) => ({ trace, observation })),
        );
  const agentKeys = orderedTraces.map((trace) => `${trace.id}:agent`);
  const everythingCollapsed = agentKeys.length > 0 && agentKeys.every((key) => collapsed.has(key));
  const toggleCollapsed = (key: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
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
      className="grid h-full min-h-0 w-full content-stretch overflow-hidden bg-background"
      aria-label="Traces"
    >
      <div className="grid h-full min-h-0 grid-cols-[minmax(280px,36%)_minmax(420px,64%)] overflow-hidden max-md:grid-cols-1">
        <nav
          className="flex h-full min-h-0 flex-col border-r bg-background max-md:max-h-80 max-md:border-b max-md:border-r-0"
          aria-label="Trace timeline"
        >
          <div className="flex shrink-0 items-center gap-1 border-b p-1.5">
            <div className="relative min-w-0 flex-1">
              <StudioIcon
                icon={MagnifyingGlass}
                aria-hidden="true"
                className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                aria-label="Search spans"
                className="h-8 border-0 bg-transparent pl-7 shadow-none focus-visible:ring-1"
                placeholder="Search spans"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <Button
              aria-label={everythingCollapsed ? "Expand all spans" : "Collapse all spans"}
              className="size-8"
              size="icon"
              title={everythingCollapsed ? "Expand all" : "Collapse all"}
              variant="ghost"
              onClick={() => setCollapsed(everythingCollapsed ? new Set() : new Set(agentKeys))}
            >
              <StudioIcon
                icon={everythingCollapsed ? ArrowsOutLineVertical : TreeStructure}
                aria-hidden="true"
              />
            </Button>
          </div>
          <div
            className="min-h-0 flex-1 overflow-auto overscroll-contain px-2 py-1"
            role="tree"
            aria-label="Span tree"
          >
            {query.length > 0 ? (
              searchResults.length > 0 ? (
                searchResults.map(({ trace, observation }) => (
                  <TraceTreeRow
                    active={
                      activeTrace.id === trace.id && activeKey === `observation:${observation.id}`
                    }
                    ancestorLevels={[]}
                    hasChildren={false}
                    isLastSibling={true}
                    key={`${trace.id}:${observation.id}`}
                    level={0}
                    tone={observation.kind}
                    title={traceObservationLabel(observation)}
                    subtitle={formatDuration(observation.durationMs)}
                    onSelect={() => selectTimelineItem(trace.id, `observation:${observation.id}`)}
                  />
                ))
              ) : (
                <div className="grid place-items-center gap-1 p-6 text-center">
                  <span className="text-sm font-medium">No matching spans</span>
                  <span className="text-xs text-muted-foreground">
                    Search by name, kind, or ID.
                  </span>
                </div>
              )
            ) : (
              orderedTraces.map((trace) => {
                const traceActive = activeTrace.id === trace.id;
                const traceTurnItems = traceTurns(trace);
                const agentKey = `${trace.id}:agent`;
                const agentCollapsed = collapsed.has(agentKey);
                return (
                  <div className="contents" key={trace.id}>
                    <TraceTreeRow
                      active={traceActive && activeKey === "agent"}
                      ancestorLevels={[]}
                      hasChildren={traceTurnItems.length > 0}
                      isLastSibling={true}
                      level={0}
                      tone="agent"
                      title={orderedTraces.length > 1 ? (trace.name ?? "agent.run") : "agent.run"}
                      subtitle={formatDuration(trace.durationMs)}
                      collapsed={agentCollapsed}
                      onSelect={() => selectTimelineItem(trace.id, "agent")}
                      onToggle={() => toggleCollapsed(agentKey)}
                    />
                    {agentCollapsed
                      ? null
                      : traceTurnItems.map((turn) => {
                          const turnKey = `${trace.id}:turn:${turn.turn}`;
                          const turnCollapsed = collapsed.has(turnKey);
                          return (
                            <div className="contents" key={turnKey}>
                              <TraceTreeRow
                                active={traceActive && activeKey === `turn:${turn.turn}`}
                                ancestorLevels={[]}
                                hasChildren={turn.observations.length > 0}
                                isLastSibling={turn.turn === traceTurnItems.at(-1)?.turn}
                                level={1}
                                tone="turn"
                                title={`turn.${turn.turn}`}
                                subtitle={formatDuration(turn.durationMs)}
                                collapsed={turnCollapsed}
                                onSelect={() => selectTimelineItem(trace.id, `turn:${turn.turn}`)}
                                onToggle={() => toggleCollapsed(turnKey)}
                              />
                              {turnCollapsed ? null : (
                                <TraceObservationRows
                                  activeKey={activeKey}
                                  collapsed={collapsed}
                                  isLastTurn={turn.turn === traceTurnItems.at(-1)?.turn}
                                  observations={turn.observations}
                                  onSelect={(observationId) =>
                                    selectTimelineItem(trace.id, `observation:${observationId}`)
                                  }
                                  onToggle={toggleCollapsed}
                                  traceActive={traceActive}
                                />
                              )}
                            </div>
                          );
                        })}
                  </div>
                );
              })
            )}
          </div>
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
  collapsed?: boolean;
  onSelect: () => void;
  onToggle?: () => void;
}) {
  return (
    <div
      aria-level={props.level + 1}
      aria-selected={props.active}
      className={cn(
        "group flex min-w-0 items-stretch text-muted-foreground hover:bg-muted/60",
        props.active && "bg-muted text-foreground",
      )}
      role="treeitem"
      tabIndex={-1}
    >
      <button
        className="flex min-w-0 flex-1 items-stretch text-left"
        type="button"
        onClick={props.onSelect}
      >
        <TraceTreeIndent
          ancestorLevels={props.ancestorLevels}
          hasChildren={props.hasChildren}
          isLastSibling={props.isLastSibling}
          level={props.level}
          tone={props.tone}
        />
        <span className="grid min-w-0 flex-1 content-center py-1.5 pr-2">
          <span className="truncate text-xs font-medium text-current" title={props.title}>
            {props.title}
          </span>
          <span className="flex flex-wrap gap-x-2 text-[10px] text-muted-foreground">
            {props.subtitle}
          </span>
        </span>
      </button>
      {props.hasChildren && props.onToggle ? (
        <button
          aria-expanded={!props.collapsed}
          aria-label={props.collapsed ? `Expand ${props.title}` : `Collapse ${props.title}`}
          className="m-1 grid size-7 shrink-0 place-items-center rounded-md hover:bg-background"
          type="button"
          onClick={props.onToggle}
        >
          <StudioIcon
            icon={CaretRight}
            aria-hidden="true"
            className={cn("size-3.5 transition-transform", !props.collapsed && "rotate-90")}
          />
        </button>
      ) : null}
    </div>
  );
}

function TraceTreeIndent(props: {
  ancestorLevels: number[];
  hasChildren: boolean;
  isLastSibling: boolean;
  level: number;
  tone: "trace" | "agent" | "turn" | StudioTrace["observations"][number]["kind"];
}) {
  const slot = 20;
  const iconX = props.level * slot;
  return (
    <span
      className="relative shrink-0"
      data-tree-depth={props.level}
      style={{ width: `${(props.level + 1) * slot + 4}px` }}
    >
      {props.ancestorLevels.map((level) => (
        <span
          className="absolute inset-y-0 w-px bg-border"
          data-tree-line="ancestor"
          key={`ancestor-line-${level}`}
          style={{ left: `${level * slot + 10}px` }}
        />
      ))}
      {props.level > 0 ? (
        props.isLastSibling ? (
          <span
            className="absolute top-0 h-1/2 rounded-bl-sm border-b border-l border-border"
            data-tree-line="elbow"
            style={{ left: `${(props.level - 1) * slot + 10}px`, width: `${slot}px` }}
          />
        ) : (
          <>
            <span
              className="absolute inset-y-0 w-px bg-border"
              data-tree-line="sibling-continuation"
              style={{ left: `${(props.level - 1) * slot + 10}px` }}
            />
            <span
              className="absolute top-1/2 h-px bg-border"
              data-tree-line="elbow"
              style={{ left: `${(props.level - 1) * slot + 10}px`, width: `${slot}px` }}
            />
          </>
        )
      ) : null}
      {props.hasChildren ? (
        <span
          className="absolute bottom-0 w-px bg-border"
          data-tree-line="children"
          style={{ left: `${iconX + 10}px`, top: "calc(50% + 0.5rem)" }}
        />
      ) : null}
      <span
        className={cn(
          "absolute top-1/2 grid size-4 -translate-y-1/2 place-items-center rounded-sm [&_svg]:size-2.5",
          traceToneIconClass(props.tone),
        )}
        style={{ left: `${iconX + 2}px` }}
      >
        <TraceToneIcon tone={props.tone} />
      </span>
    </span>
  );
}

function TraceObservationRows(props: {
  activeKey: TraceInspectorKey;
  collapsed: Set<string>;
  isLastTurn: boolean;
  observations: TraceObservationItem[];
  traceActive: boolean;
  onSelect: (observationId: string) => void;
  onToggle: (key: string) => void;
}) {
  const roots = traceObservationTree(props.observations);
  return (
    <>
      {roots.map((node, index) => (
        <TraceObservationNodeRow
          activeKey={props.activeKey}
          ancestorLevels={props.isLastTurn ? [] : [0]}
          collapsed={props.collapsed}
          isLastSibling={index === roots.length - 1}
          key={node.observation.id}
          level={2}
          node={node}
          onSelect={props.onSelect}
          onToggle={props.onToggle}
          traceActive={props.traceActive}
        />
      ))}
    </>
  );
}

function TraceObservationNodeRow(props: {
  activeKey: TraceInspectorKey;
  ancestorLevels: number[];
  collapsed: Set<string>;
  isLastSibling: boolean;
  level: number;
  node: TraceObservationNode;
  traceActive: boolean;
  onSelect: (observationId: string) => void;
  onToggle: (key: string) => void;
}) {
  const usageText = observationUsageText(props.node.observation);
  const collapseKey = `observation:${props.node.observation.id}`;
  const isCollapsed = props.collapsed.has(collapseKey);
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
        collapsed={isCollapsed}
        onSelect={() => props.onSelect(props.node.observation.id)}
        onToggle={() => props.onToggle(collapseKey)}
      />
      {isCollapsed
        ? null
        : props.node.children.map((child, index) => (
            <TraceObservationNodeRow
              activeKey={props.activeKey}
              ancestorLevels={childAncestorLevels}
              collapsed={props.collapsed}
              isLastSibling={index === props.node.children.length - 1}
              key={child.observation.id}
              level={props.level + 1}
              node={child}
              onSelect={props.onSelect}
              onToggle={props.onToggle}
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
  const [payloadView, setPayloadView] = useState<"formatted" | "json">("formatted");
  return (
    <section
      className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-background"
      aria-label="Trace detail"
    >
      <header className="shrink-0 border-b px-4 py-4 md:px-6">
        <div className="grid min-w-0 gap-4">
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span
                className={cn(
                  "grid size-9 shrink-0 place-items-center rounded-lg [&_svg]:size-4",
                  traceToneIconClass(selected.tone),
                )}
              >
                <TraceToneIcon tone={selected.tone} />
              </span>
              <div className="grid min-w-0 gap-1">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <h2 className="m-0 min-w-0 truncate text-xl font-semibold tracking-tight">
                    {selected.title}
                  </h2>
                  <TraceStatusBadge status={selected.status} />
                </div>
                <div className="text-xs text-muted-foreground">{selected.startedAt}</div>
              </div>
            </div>
            <PayloadViewSwitch value={payloadView} onChange={setPayloadView} />
          </div>
          <div className="flex flex-wrap gap-2">
            <TraceMetric
              icon={<StudioIcon icon={Clock} aria-hidden="true" />}
              label="Duration"
              value={formatDuration(selected.durationMs)}
            />
            {selected.firstDeltaMs === undefined ? null : (
              <TraceMetric
                icon={<StudioIcon icon={Timer} aria-hidden="true" />}
                label="First delta"
                value={formatDuration(selected.firstDeltaMs)}
              />
            )}
            {selected.usage.length === 0 ? null : (
              <TraceMetric
                icon={<StudioIcon icon={BracketsCurly} aria-hidden="true" />}
                label="Usage"
                value={selected.usage}
              />
            )}
            <button
              className="flex min-w-0 items-center gap-2 rounded-md border bg-muted/20 px-2.5 py-1.5 text-xs hover:bg-muted/60"
              type="button"
              onClick={() => props.onShowSessionTraces(props.trace.sessionId)}
            >
              <StudioIcon
                icon={ArrowSquareOut}
                aria-hidden="true"
                className="size-3.5 text-muted-foreground"
              />
              <span className="text-muted-foreground">Session</span>
              <span className="max-w-44 truncate font-mono font-medium">
                {props.trace.sessionId}
              </span>
            </button>
          </div>
        </div>
      </header>
      <div className="min-w-0 overflow-auto">
        <div className="grid min-w-0 content-start gap-6 p-6">
          {selected.input === undefined ? null : (
            <TraceDataSection title="Input" value={selected.input} view={payloadView} />
          )}
          {selected.output === undefined ? null : (
            <TraceDataSection
              title="Output"
              value={selected.output}
              tone="success"
              view={payloadView}
            />
          )}
          {selected.error === undefined ? null : (
            <TraceDataSection
              title="Error"
              value={selected.error}
              tone="error"
              view={payloadView}
            />
          )}
          <TraceDataSection title="Metadata" value={selected.metadata} view={payloadView} />
        </div>
      </div>
    </section>
  );
}

function TraceMetric(props: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-md border bg-muted/20 px-2.5 py-1.5 text-xs">
      <span className="text-muted-foreground [&_svg]:size-3.5">{props.icon}</span>
      <span className="text-muted-foreground">{props.label}</span>
      <span className="max-w-44 truncate font-mono font-medium">{props.value}</span>
    </div>
  );
}

function PayloadViewSwitch(props: {
  value: "formatted" | "json";
  onChange: (value: "formatted" | "json") => void;
}) {
  return (
    <fieldset
      className="flex h-8 items-center rounded-md border bg-muted/50 p-0.5"
      aria-label="Payload view"
    >
      {(["formatted", "json"] as const).map((view) => (
        <button
          aria-pressed={props.value === view}
          className={cn(
            "h-6 rounded px-2 text-xs font-medium text-muted-foreground",
            props.value === view && "bg-background text-foreground shadow-sm",
          )}
          key={view}
          type="button"
          onClick={() => props.onChange(view)}
        >
          {view === "formatted" ? "Formatted" : "JSON"}
        </button>
      ))}
    </fieldset>
  );
}

function TraceDataSection(props: {
  title: string;
  value: unknown;
  tone?: "success" | "error";
  compact?: boolean;
  view: "formatted" | "json";
}) {
  const rows = plainTraceValue(props.title, props.value);
  return (
    <section className="grid min-w-0 gap-3">
      <div className="flex items-center gap-3">
        <h3 className="m-0 text-sm font-semibold">{props.title}</h3>
        <span className="h-px flex-1 bg-border" aria-hidden="true" />
      </div>
      {props.view === "json" ? (
        <TraceJsonTree value={props.value} />
      ) : (
        <div className="grid min-w-0 gap-2">
          {rows.map((item) => (
            <article
              className={cn(
                "grid min-w-0 gap-2 rounded-lg border bg-muted/10 px-4 py-3",
                props.compact &&
                  "grid-cols-[150px_minmax(0,1fr)] items-start gap-4 max-lg:grid-cols-1",
              )}
              key={`${item.label}-${item.text}`}
            >
              <span className="flex min-w-0 items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
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
              <span className=" text-xs font-semibold tabular-nums text-muted-foreground">
                {item.index}
              </span>
              <Badge
                className={cn(
                  "px-1.5 py-0.5",
                  item.role === "User" &&
                    "border-border/80 bg-muted-foreground/15 text-muted-foreground",
                  item.role === "Assistant" && "border-border/80 bg-foreground/15 text-foreground",
                  item.role === "Tool" &&
                    "border-destructive/40 bg-destructive/15 text-destructive",
                )}
              >
                {item.role}
              </Badge>
            </div>
            <p className="m-0 whitespace-pre-wrap text-sm leading-6 text-foreground [overflow-wrap:anywhere]">
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
        "m-0 whitespace-pre-wrap text-sm leading-6 text-foreground [overflow-wrap:anywhere]",
        props.tone === "success" && !isNeutralTraceRow(props.item) && "text-foreground",
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
