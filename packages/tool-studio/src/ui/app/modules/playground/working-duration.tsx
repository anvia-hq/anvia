import { cn } from "../../lib/utils";

export function WorkingDuration(props: {
  className?: string | undefined;
  durationMs?: number | undefined;
}) {
  if (props.durationMs === undefined) {
    return null;
  }

  return (
    <span
      aria-live="off"
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-medium tabular-nums text-muted-foreground",
        props.className,
      )}
    >
      {formatWorkingDuration(props.durationMs)}
    </span>
  );
}

export function formatWorkingDuration(durationMs: number): string {
  const normalizedDurationMs = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
  const totalSeconds = Math.floor(normalizedDurationMs / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const duration = minutes === 0 ? `${seconds}s` : `${minutes}m ${seconds}s`;
  return `Finished - ${duration}`;
}
