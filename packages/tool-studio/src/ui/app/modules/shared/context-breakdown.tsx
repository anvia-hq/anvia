import { cn } from "../../lib/utils";
import { isRecord } from "./object";

const SEGMENT_LABELS: Readonly<Record<string, string>> = {
  instructions: "System prompt",
  messages: "Messages",
  toolResults: "Tool results",
  documents: "Documents",
  tools: "Tool definitions",
  mcpTools: "MCP tools",
  providerTools: "Provider tools",
  outputSchema: "Output schema",
};

const SEGMENT_COLORS: Readonly<Record<string, string>> = {
  instructions: "bg-tone-agent",
  messages: "bg-chart-2",
  toolResults: "bg-tone-tool",
  documents: "bg-chart-4",
  tools: "bg-chart-1",
  mcpTools: "bg-chart-3",
  providerTools: "bg-chart-5",
  outputSchema: "bg-dim",
};

export type ContextSegmentView = Readonly<{
  id: string;
  label: string;
  tokens: number;
  items: number;
}>;

export type ContextBreakdownView = Readonly<{
  segments: readonly ContextSegmentView[];
  totalTokens: number;
  /** Provider-reported input tokens; present when segments were scaled to them. */
  reportedInputTokens?: number;
}>;

export function contextSegmentLabel(id: string): string {
  return SEGMENT_LABELS[id] ?? id;
}

export function contextSegmentColor(id: string): string {
  return SEGMENT_COLORS[id] ?? "bg-muted-foreground";
}

/** Reads a context breakdown out of trace metadata, ignoring anything malformed. */
export function contextBreakdownView(value: unknown): ContextBreakdownView | undefined {
  if (!isRecord(value) || !Array.isArray(value.segments)) {
    return undefined;
  }
  const segments: ContextSegmentView[] = [];
  for (const segment of value.segments) {
    if (!isRecord(segment) || typeof segment.id !== "string") continue;
    if (typeof segment.tokens !== "number" || !Number.isFinite(segment.tokens)) continue;
    segments.push({
      id: segment.id,
      label: contextSegmentLabel(segment.id),
      tokens: Math.max(0, Math.round(segment.tokens)),
      items: typeof segment.items === "number" ? segment.items : 0,
    });
  }
  if (segments.length === 0) {
    return undefined;
  }
  const totalTokens = segments.reduce((total, segment) => total + segment.tokens, 0);
  const reportedInputTokens =
    typeof value.reportedInputTokens === "number" && value.reportedInputTokens > 0
      ? value.reportedInputTokens
      : undefined;
  return reportedInputTokens === undefined
    ? { segments, totalTokens }
    : { segments, totalTokens, reportedInputTokens };
}

export function formatContextTokens(value: number): string {
  return value.toLocaleString();
}

export function contextSegmentPercent(segment: ContextSegmentView, total: number): number {
  return total <= 0 ? 0 : (segment.tokens / total) * 100;
}

/** Stacked bar of one context breakdown, in segment order. */
export function ContextBreakdownBar(props: {
  view: ContextBreakdownView;
  className?: string | undefined;
}) {
  const total = props.view.totalTokens;
  if (total <= 0) return null;
  return (
    <div
      className={cn("flex h-2 w-full overflow-hidden rounded-full bg-muted", props.className)}
      role="img"
      aria-label="Context breakdown"
    >
      {props.view.segments.map((segment) => (
        <span
          className={cn("h-full", contextSegmentColor(segment.id))}
          key={segment.id}
          style={{ width: `${contextSegmentPercent(segment, total)}%` }}
          title={`${segment.label}: ${formatContextTokens(segment.tokens)} tokens`}
        />
      ))}
    </div>
  );
}

/** Full breakdown: header, stacked bar, and one row per segment. */
export function ContextBreakdown(props: { view: ContextBreakdownView }) {
  const total = props.view.totalTokens;
  return (
    <section className="grid min-w-0 gap-3" aria-label="Context breakdown">
      <header className="flex min-w-0 items-center gap-3">
        <h3 className="m-0 text-sm font-semibold">Context</h3>
        <span className="ml-auto font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
          {props.view.reportedInputTokens === undefined
            ? "Estimated split"
            : "Split of reported input"}
        </span>
      </header>
      <div className="grid min-w-0 gap-3">
        <ContextBreakdownBar view={props.view} />
        <div className="flex min-w-0 items-center justify-between gap-3 text-xs">
          <span className="text-muted-foreground">Input</span>
          <span className="font-medium tabular-nums">{formatContextTokens(total)} tokens</span>
        </div>
        <ul className="m-0 grid min-w-0 list-none gap-1.5 p-0 text-xs">
          {props.view.segments.map((segment) => (
            <li className="flex min-w-0 items-center gap-2" key={segment.id}>
              <span
                className={cn("size-2 shrink-0 rounded-full", contextSegmentColor(segment.id))}
              />
              <span className="min-w-0 truncate text-muted-foreground">{segment.label}</span>
              <span className="ml-auto shrink-0 tabular-nums">
                {formatContextTokens(segment.tokens)}
              </span>
              <span className="w-11 shrink-0 text-right tabular-nums text-muted-foreground">
                {contextSegmentPercent(segment, total).toFixed(0)}%
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/** Compact breakdown for a metric card: bar plus the segments that cost the most. */
export function ContextBreakdownSummary(props: { view: ContextBreakdownView }) {
  const total = props.view.totalTokens;
  const leading = [...props.view.segments]
    .sort((left, right) => right.tokens - left.tokens)
    .slice(0, 3);
  return (
    <div className="grid min-w-0 gap-1.5">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <span className="text-muted-foreground">Context</span>
        <span className="shrink-0 font-medium tabular-nums">
          {formatContextTokens(total)} tokens
        </span>
      </div>
      <ContextBreakdownBar view={props.view} />
      <div className="flex min-w-0 flex-wrap gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
        {leading.map((segment) => (
          <span className="min-w-0" key={segment.id}>
            <span className="text-muted-foreground">{segment.label}</span>{" "}
            <span className="tabular-nums text-foreground">
              {formatContextTokens(segment.tokens)}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
