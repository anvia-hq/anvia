import { useEffect, useState } from "react";
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
      className={cn("text-xs font-medium tabular-nums text-muted-foreground", props.className)}
      role={isActive ? "timer" : undefined}
    >
      {formatWorkingDuration(elapsedMs)}
    </span>
  );
}

export function formatWorkingDuration(durationMs: number): string {
  const normalizedDurationMs = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
  const totalSeconds = Math.floor(normalizedDurationMs / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `Working - ${minutes}m ${seconds}s`;
}
