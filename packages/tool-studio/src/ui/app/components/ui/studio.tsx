import type * as React from "react";
import { cn } from "@/lib/utils";

export function StudioPageShell({ className, ...props }: React.ComponentProps<"section">) {
  return (
    <section
      className={cn(
        "grid h-full min-h-0 min-w-0 max-h-full max-w-full overflow-hidden bg-background/45",
        className,
      )}
      {...props}
    />
  );
}

export function StudioSurface({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "min-h-0 min-w-0 overflow-hidden rounded-2xl border border-border/80 bg-card/70",
        className,
      )}
      {...props}
    />
  );
}

export function StudioSection({ className, ...props }: React.ComponentProps<"section">) {
  return (
    <section
      className={cn(
        "grid gap-3 rounded-xl border border-border/80 bg-background/45 p-5",
        className,
      )}
      {...props}
    />
  );
}

export function StudioMetric(props: { label: string; value: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "grid gap-1 rounded-xl border border-border/80 bg-card/45 p-4",
        props.className,
      )}
    >
      <span className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {props.label}
      </span>
      <span className="text-lg font-semibold tabular-nums text-foreground">{props.value}</span>
    </div>
  );
}

export function StudioEmptyState(props: { title: string; text: string; className?: string }) {
  return (
    <div
      className={cn(
        "grid min-h-80 place-items-center rounded-xl border border-dashed border-border/80 bg-card/35 px-6 text-center",
        props.className,
      )}
    >
      <div className="grid max-w-md gap-2">
        <h2 className="m-0 text-base font-semibold text-foreground">{props.title}</h2>
        <p className="m-0 text-sm leading-6 text-muted-foreground">{props.text}</p>
      </div>
    </div>
  );
}

export function StudioStatusBadge({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-lg border border-border/80 bg-muted/55 px-2 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function StudioTabs({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("grid gap-1 rounded-xl border border-border/80 bg-background p-1", className)}
      {...props}
    />
  );
}
