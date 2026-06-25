import { useEffect, useRef } from "react";
import type { StudioPipelineLogEntry } from "../../../../types";
import { cn } from "../../lib/utils";
import { formatLogMetadataText, LogMetadata } from "../shared/log-metadata";

export function PipelineLogsPanel(props: {
  logs: StudioPipelineLogEntry[];
  selectedPipelineId: string;
  loading: boolean;
}) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);

  useEffect(() => {
    const node = scrollerRef.current;
    if (node === null || !stickToBottomRef.current) {
      return;
    }
    node.scrollTop = node.scrollHeight;
  });

  function updateStickiness() {
    const node = scrollerRef.current;
    if (node === null) {
      return;
    }
    stickToBottomRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 24;
  }

  return (
    <aside className="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-background/70 max-xl:hidden">
      <header className="grid min-h-12 min-w-0 gap-1 border-b border-border/80 bg-card/35 px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="m-0 text-sm font-semibold leading-tight text-foreground">Pipeline logs</h2>
          <span className="font-mono text-[10px] font-semibold tabular-nums text-muted-foreground">
            {props.logs.length}
          </span>
        </div>
        <p className="m-0 truncate font-mono text-[11px] font-medium text-muted-foreground">
          {props.selectedPipelineId.length === 0 ? "No active pipeline" : props.selectedPipelineId}
        </p>
      </header>
      <div
        className="min-h-0 min-w-0 overflow-x-auto overflow-y-auto"
        ref={scrollerRef}
        onScroll={updateStickiness}
      >
        {props.selectedPipelineId.length === 0 ? (
          <div className="grid h-full min-h-80 place-items-center p-8 text-center">
            <div className="max-w-xs">
              <p className="m-0 text-sm font-semibold text-foreground">No pipeline selected</p>
              <p className="m-0 mt-2 text-sm leading-6 text-muted-foreground">
                Register a pipeline to view runtime logs.
              </p>
            </div>
          </div>
        ) : null}
        {props.selectedPipelineId.length > 0 && props.loading && props.logs.length === 0 ? (
          <div className="grid gap-2 px-4 py-4">
            <div className="h-4 w-32 animate-pulse rounded-lg bg-muted" />
            <div className="h-4 w-64 animate-pulse rounded-lg bg-muted/60" />
            <div className="h-4 w-52 animate-pulse rounded-lg bg-muted/60" />
          </div>
        ) : null}
        {props.selectedPipelineId.length > 0 && !props.loading && props.logs.length === 0 ? (
          <div className="px-5 py-5 text-sm font-medium text-muted-foreground">
            No logs yet. Run the pipeline to populate this console.
          </div>
        ) : null}
        <div className="grid min-w-full gap-1 p-2 font-mono">
          {props.logs.map((log) => (
            <LogRow log={log} key={log.id} />
          ))}
        </div>
      </div>
    </aside>
  );
}

function LogRow(props: { log: StudioPipelineLogEntry }) {
  const metadataText = formatLogMetadataText(props.log.metadata);
  const line = [
    formatLogTime(props.log.timestamp),
    props.log.level.toUpperCase().padEnd(5, " "),
    props.log.message,
    `${props.log.category}/${props.log.event}`,
    metadataText,
  ]
    .filter((item) => item.trim().length > 0)
    .join("  ");
  return (
    <article
      className={cn(
        "min-w-full rounded-lg px-4 py-1.5 text-[11px] leading-5 transition duration-200 hover:bg-black/[0.04] dark:hover:bg-white/[0.04]",
      )}
      title={line}
    >
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        <time className="shrink-0 text-muted-foreground">{formatLogTime(props.log.timestamp)}</time>
        <span className={cn("shrink-0 font-semibold", levelTextClass(props.log.level))}>
          {props.log.level.toUpperCase().padEnd(5, " ")}
        </span>
        <span className="min-w-0 break-words font-medium text-foreground">{props.log.message}</span>
      </div>
      <div className="mt-1 min-w-0 break-words text-muted-foreground/80">
        {props.log.category}/{props.log.event}
      </div>
      <LogMetadata metadata={props.log.metadata} />
      <span className="sr-only">{line}</span>
    </article>
  );
}

function formatLogTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function levelTextClass(level: StudioPipelineLogEntry["level"]): string {
  switch (level) {
    case "error":
      return "text-destructive";
    case "warn":
      return "text-muted-foreground";
    case "debug":
      return "text-muted-foreground";
    case "info":
      return "text-foreground";
  }
}
