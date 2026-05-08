import { useEffect, useRef } from "react";
import type { StudioSessionLogEntry } from "../../../../types";
import { cn } from "../../lib/utils";

export function SessionLogsPanel(props: {
  logs: StudioSessionLogEntry[];
  selectedSessionId: string;
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
    <aside className="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden border-l border-border/80 bg-background/70 max-xl:hidden">
      <header className="grid min-h-12 min-w-0 gap-1 border-b border-border/80 bg-card/35 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="m-0 text-sm font-semibold leading-tight text-foreground">Session logs</h2>
          <span className="font-mono text-[10px] font-semibold tabular-nums text-muted-foreground">
            {props.logs.length}
          </span>
        </div>
        <p className="m-0 truncate font-mono text-[11px] font-medium text-muted-foreground">
          {props.selectedSessionId.length === 0 ? "No active session" : props.selectedSessionId}
        </p>
      </header>
      <div
        className="min-h-0 min-w-0 overflow-x-auto overflow-y-auto"
        ref={scrollerRef}
        onScroll={updateStickiness}
      >
        {props.selectedSessionId.length === 0 ? (
          <div className="grid h-full min-h-80 place-items-center text-center text-sm font-medium text-muted-foreground">
            Start or open a session to view runtime logs.
          </div>
        ) : null}
        {props.selectedSessionId.length > 0 && props.loading && props.logs.length === 0 ? (
          <div className="px-2 py-3 text-sm font-medium text-muted-foreground">Loading logs</div>
        ) : null}
        {props.selectedSessionId.length > 0 && !props.loading && props.logs.length === 0 ? (
          <div className="px-2 py-3 text-sm font-medium text-muted-foreground">No logs yet</div>
        ) : null}
        <div className="grid min-w-full border-t border-border/65 font-mono">
          {props.logs.map((log) => (
            <LogRow log={log} key={log.id} />
          ))}
        </div>
      </div>
    </aside>
  );
}

function LogRow(props: { log: StudioSessionLogEntry }) {
  const metadata = Object.entries(props.log.metadata ?? {}).slice(0, 6);
  const metadataText = metadata.map(([key, value]) => `${key}=${formatMetadata(value)}`).join(" ");
  const line = [
    formatLogTime(props.log.timestamp),
    props.log.level.toUpperCase().padEnd(5, " "),
    `${props.log.category}/${props.log.event}`,
    props.log.message,
    metadataText,
  ]
    .filter((item) => item.trim().length > 0)
    .join("  ");
  return (
    <article
      className={cn(
        "w-max min-w-full whitespace-nowrap border-l-2 px-3 py-1 text-[11px] leading-5 transition duration-200 hover:bg-accent/45",
        levelBorderClass(props.log.level),
      )}
      title={line}
    >
      <time className="text-muted-foreground">{formatLogTime(props.log.timestamp)}</time>
      <span className={cn("ml-3 font-semibold", levelTextClass(props.log.level))}>
        {props.log.level.toUpperCase().padEnd(5, " ")}
      </span>
      <span className="ml-3 text-muted-foreground">
        {props.log.category}/{props.log.event}
      </span>
      <span className="ml-3 font-medium text-foreground">{props.log.message}</span>
      <span className="ml-3 text-muted-foreground/85">{metadataText}</span>
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

function formatMetadata(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.length}]`;
  }
  if (typeof value === "object" && value !== null) {
    return "{...}";
  }
  return "";
}

function levelBorderClass(level: StudioSessionLogEntry["level"]): string {
  switch (level) {
    case "error":
      return "border-destructive";
    case "warn":
      return "border-yellow-500";
    case "debug":
      return "border-muted-foreground/45";
    case "info":
      return "border-primary/70";
  }
}

function levelTextClass(level: StudioSessionLogEntry["level"]): string {
  switch (level) {
    case "error":
      return "text-destructive";
    case "warn":
      return "text-yellow-500";
    case "debug":
      return "text-muted-foreground";
    case "info":
      return "text-primary";
  }
}
