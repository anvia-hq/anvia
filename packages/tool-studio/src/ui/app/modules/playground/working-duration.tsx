import { Loading03Icon } from "@hugeicons/core-free-icons";
import { useEffect, useState } from "react";
import { StudioIcon } from "../../components/ui/icon";
import { cn } from "../../lib/utils";

export function WorkingDuration(props: {
  className?: string | undefined;
  durationMs?: number | undefined;
  startedAt?: number | undefined;
}) {
  const [now, setNow] = useState(() => Date.now());
  const isActive = props.startedAt !== undefined && props.durationMs === undefined;

  useEffect(() => {
    if (!isActive) {
      return;
    }
    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [isActive]);

  const elapsedMs =
    props.durationMs ?? (props.startedAt === undefined ? undefined : now - props.startedAt);
  if (elapsedMs === undefined) {
    return null;
  }

  return (
    <span
      aria-live="off"
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-medium tabular-nums text-muted-foreground",
        props.className,
      )}
      role={isActive ? "timer" : undefined}
    >
      {isActive ? (
        <StudioIcon
          aria-hidden="true"
          className="h-3.5 w-3.5 shrink-0 animate-spin"
          icon={Loading03Icon}
        />
      ) : null}
      {formatWorkingDuration(elapsedMs, isActive ? "working" : "finished")}
    </span>
  );
}

export function formatWorkingDuration(
  durationMs: number,
  state: "working" | "finished" = "working",
): string {
  const normalizedDurationMs = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
  const totalSeconds = Math.floor(normalizedDurationMs / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const duration = minutes === 0 ? `${seconds}s` : `${minutes}m ${seconds}s`;
  return `${state === "working" ? "Working" : "Finished"} - ${duration}`;
}
