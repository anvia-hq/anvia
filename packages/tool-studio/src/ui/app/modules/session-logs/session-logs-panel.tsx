import { useEffect, useRef } from "react";
import type { StudioSessionLogEntry } from "../../../../types";
import { cn } from "../../lib/utils";
import { formatLogMetadataText, LogMetadata } from "../shared/log-metadata";

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
    <aside className="grid h-full min-h-0 min-w-0 max-h-full grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-background/70 max-xl:hidden">
      <header className="grid min-h-12 min-w-0 gap-1 py-3 pl-0 pr-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="m-0 text-sm font-semibold leading-tight text-foreground">Session logs</h2>
          <span className=" text-xs font-semibold tabular-nums text-muted-foreground">
            {props.logs.length}
          </span>
        </div>
        <p className="m-0 truncate text-xs font-medium text-muted-foreground">
          {props.selectedSessionId.length === 0 ? "No active session" : props.selectedSessionId}
        </p>
      </header>
      <div
        className="min-h-0 min-w-0 overflow-y-auto overflow-x-hidden"
        ref={scrollerRef}
        onScroll={updateStickiness}
      >
        {props.selectedSessionId.length === 0 ? (
          <div className="grid h-full min-h-80 place-items-center text-center text-sm font-medium text-muted-foreground">
            Start or open a session to view runtime logs.
          </div>
        ) : null}
        {props.selectedSessionId.length > 0 && props.loading && props.logs.length === 0 ? (
          <div className="py-3 pl-0 pr-2 text-sm font-medium text-muted-foreground">
            Loading logs
          </div>
        ) : null}
        {props.selectedSessionId.length > 0 && !props.loading && props.logs.length === 0 ? (
          <div className="py-3 pl-0 pr-2 text-sm font-medium text-muted-foreground">
            No logs yet
          </div>
        ) : null}
        <div className="grid min-w-0 gap-1 py-2 pl-0 pr-2 ">
          {props.logs.map((log) => (
            <LogRow log={log} key={log.id} />
          ))}
        </div>
      </div>
    </aside>
  );
}

function LogRow(props: { log: StudioSessionLogEntry }) {
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
      className="grid min-w-0 gap-1 rounded-lg px-3 py-2 text-xs leading-5 transition duration-200 hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
      title={line}
    >
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
        <time className="shrink-0 text-muted-foreground">{formatLogTime(props.log.timestamp)}</time>
        <span className={cn("shrink-0 font-semibold", levelTextClass(props.log.level))}>
          {props.log.level.toUpperCase()}
        </span>
        <span className="min-w-0 break-words font-medium text-foreground">{props.log.message}</span>
      </div>
      <div className="min-w-0 break-words text-muted-foreground/80">
        {props.log.category}/{props.log.event}
      </div>
      <LogMetadata metadata={props.log.metadata} />
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

function levelTextClass(level: StudioSessionLogEntry["level"]): string {
  switch (level) {
    case "error":
      return "text-destructive";
    case "warn":
      return "text-yellow-500";
    case "debug":
      return "text-muted-foreground";
    case "info":
      return "text-foreground";
  }
}
