import type {
  StudioMachineMonitorHistory,
  StudioMachineMonitorRange,
  StudioMachineMonitorSample,
  StudioMachineMonitorSummary,
} from "../../../../types";
import { Button } from "../../components/ui/button";

export function MachineMonitorPanel(props: {
  summary: StudioMachineMonitorSummary | undefined;
  history: StudioMachineMonitorHistory | undefined;
  range: StudioMachineMonitorRange;
  loading: boolean;
  error: string;
  onRangeChange: (range: StudioMachineMonitorRange) => void;
}) {
  if (props.summary === undefined) {
    return (
      <section className="grid gap-3 border-y border-dashed border-hair px-3 py-8 text-center">
        <h2 className="m-0 text-sm font-semibold text-foreground">Machine monitor unavailable</h2>
        <p className="m-0 text-sm text-muted-foreground">
          This Studio runtime did not enable machine sampling.
        </p>
      </section>
    );
  }

  const current = props.summary.current;
  const memoryPercent = percent(current.memoryUsedBytes, current.memoryTotalBytes);
  return (
    <section className="grid gap-4" aria-label="Machine monitor">
      <div className="flex min-w-0 flex-wrap items-end justify-between gap-3">
        <div className="grid gap-1">
          <h2 className="m-0 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            machine monitor
          </h2>
          <p className="m-0 text-xs text-muted-foreground">
            Live resources and retained history for {props.summary.sourceId}
          </p>
        </div>
        <div className="flex gap-1" aria-label="History range">
          {props.summary.availableRanges.map((range) => (
            <Button
              key={range}
              type="button"
              size="sm"
              variant={range === props.range ? "default" : "secondary"}
              aria-pressed={range === props.range}
              onClick={() => props.onRangeChange(range)}
            >
              {range === "7d" ? "7 days" : "30 days"}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid border-y border-hair sm:grid-cols-2 xl:grid-cols-4 xl:divide-x xl:divide-hair">
        <Metric label="CPU" value={`${formatNumber(current.cpuPercent)}%`} detail="machine usage" />
        <Metric
          label="Memory"
          value={`${formatNumber(memoryPercent)}%`}
          detail={`${formatBytes(current.memoryUsedBytes)} / ${formatBytes(current.memoryTotalBytes)}`}
        />
        <Metric
          label="Studio RSS"
          value={formatBytes(current.processRssBytes)}
          detail="process memory"
        />
        <Metric
          label="Load average"
          value={formatNumber(current.loadAverage1m)}
          detail={`${formatNumber(current.loadAverage5m)} / ${formatNumber(current.loadAverage15m)} (5m / 15m)`}
        />
      </div>

      <div className="grid min-h-72 gap-3 border-y border-hair px-3 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <Legend color="bg-chart-2" label="CPU (%)" />
            <Legend color="bg-chart-1" label="Memory (%)" />
          </div>
          <span className="text-xs text-muted-foreground">
            {props.history === undefined
              ? `${props.summary.sampleIntervalSeconds}s raw samples`
              : `${props.history.samples.length} points · ${formatBucket(props.history.bucketSeconds)} buckets`}
          </span>
        </div>
        {props.loading && props.history === undefined ? (
          <HistoryMessage title="Loading history" text="Reading retained machine samples." />
        ) : props.error.length > 0 ? (
          <HistoryMessage title="History unavailable" text={props.error} tone="error" />
        ) : props.history === undefined || props.history.samples.length < 2 ? (
          <HistoryMessage
            title="History is building"
            text="Current readings are available now. The chart appears after two samples are retained."
          />
        ) : (
          <MachineHistoryChart history={props.history} />
        )}
      </div>
      <p className="m-0 text-xs text-muted-foreground">
        Timestamps are stored in UTC and displayed in your browser&apos;s local time. Samples older
        than {props.summary.retentionDays} days are removed automatically.
      </p>
    </section>
  );
}

export function MachineHistoryChart(props: { history: StudioMachineMonitorHistory }) {
  const width = 1000;
  const height = 260;
  const padding = { top: 18, right: 18, bottom: 34, left: 42 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const samples = props.history.samples;
  const firstTime = Date.parse(props.history.from);
  const lastTime = Date.parse(props.history.to);
  const span = Math.max(1, lastTime - firstTime);
  const point = (sample: StudioMachineMonitorSample, value: number) => {
    const x = padding.left + ((Date.parse(sample.timestamp) - firstTime) / span) * plotWidth;
    const y = padding.top + (1 - Math.min(100, Math.max(0, value)) / 100) * plotHeight;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  };
  const cpuPath = samples.map((sample) => point(sample, sample.cpuPercent)).join(" ");
  const memoryPath = samples
    .map((sample) => point(sample, percent(sample.memoryUsedBytes, sample.memoryTotalBytes)))
    .join(" ");
  const ticks = [100, 75, 50, 25, 0];

  return (
    <div className="min-w-0 overflow-x-auto">
      <svg
        className="h-64 min-w-[42rem] w-full"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${props.history.range} CPU and memory utilization history`}
      >
        {ticks.map((tick) => {
          const y = padding.top + (1 - tick / 100) * plotHeight;
          return (
            <g key={tick}>
              <line
                x1={padding.left}
                x2={width - padding.right}
                y1={y}
                y2={y}
                className="stroke-hair"
                vectorEffect="non-scaling-stroke"
              />
              <text
                x={padding.left - 8}
                y={y + 4}
                textAnchor="end"
                className="fill-muted-foreground text-[11px]"
              >
                {tick}%
              </text>
            </g>
          );
        })}
        <polyline
          points={memoryPath}
          fill="none"
          className="stroke-chart-1"
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        <polyline
          points={cpuPath}
          fill="none"
          className="stroke-chart-2"
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        <text
          x={padding.left}
          y={height - 8}
          textAnchor="start"
          className="fill-muted-foreground text-[11px]"
        >
          {formatTimestamp(props.history.from)}
        </text>
        <text
          x={width - padding.right}
          y={height - 8}
          textAnchor="end"
          className="fill-muted-foreground text-[11px]"
        >
          {formatTimestamp(props.history.to)}
        </text>
        {samples.map((sample) => (
          <circle
            key={sample.timestamp}
            cx={padding.left + ((Date.parse(sample.timestamp) - firstTime) / span) * plotWidth}
            cy={
              padding.top + (1 - Math.min(100, Math.max(0, sample.cpuPercent)) / 100) * plotHeight
            }
            r="6"
            fill="transparent"
          >
            <title>{`${formatTimestamp(sample.timestamp)} — CPU ${formatNumber(sample.cpuPercent)}%, memory ${formatNumber(percent(sample.memoryUsedBytes, sample.memoryTotalBytes))}%`}</title>
          </circle>
        ))}
      </svg>
    </div>
  );
}

function Metric(props: { label: string; value: string; detail: string }) {
  return (
    <div className="grid gap-1 border-b border-hair px-3 py-3 last:border-b-0 sm:[&:nth-last-child(-n+2)]:border-b-0 xl:border-b-0">
      <span className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {props.label}
      </span>
      <span className="text-xl font-semibold tabular-nums text-foreground">{props.value}</span>
      <span className="text-xs text-muted-foreground">{props.detail}</span>
    </div>
  );
}

function Legend(props: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`size-2 rounded-full ${props.color}`} />
      {props.label}
    </span>
  );
}

function HistoryMessage(props: { title: string; text: string; tone?: "error" }) {
  return (
    <div className="grid min-h-52 place-items-center border border-dashed border-hair px-6 text-center">
      <div className="grid max-w-md gap-1">
        <h3
          className={`m-0 text-sm font-semibold ${props.tone === "error" ? "text-status-danger-ink" : "text-foreground"}`}
        >
          {props.title}
        </h3>
        <p className="m-0 text-sm text-muted-foreground">{props.text}</p>
      </div>
    </div>
  );
}

function percent(used: number, total: number): number {
  return total <= 0 ? 0 : (used / total) * 100;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value);
}

function formatBytes(value: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${formatNumber(size)} ${units[unit]}`;
}

function formatBucket(seconds: number): string {
  if (seconds >= 3600) return `${seconds / 3600}h`;
  if (seconds >= 60) return `${seconds / 60}m`;
  return `${seconds}s`;
}

function formatTimestamp(timestamp: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}
