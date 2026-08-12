import type * as React from "react";
import { cn } from "@/lib/utils";

export function StudioPageShell({ className, ...props }: React.ComponentProps<"section">) {
  return (
    <section
      className={cn(
        "grid h-full min-h-0 min-w-0 max-h-full max-w-full overflow-hidden bg-background",
        className,
      )}
      {...props}
    />
  );
}

export function StudioSurface({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div className={cn("min-h-0 min-w-0 overflow-hidden bg-background", className)} {...props} />
  );
}

export function StudioSection({ className, ...props }: React.ComponentProps<"section">) {
  return (
    <section
      className={cn("grid gap-3 rounded-xl border border-border bg-card p-4", className)}
      {...props}
    />
  );
}

export function StudioMetric(props: { label: string; value: React.ReactNode; className?: string }) {
  return (
    <div className={cn("grid gap-1 rounded-xl border border-border bg-card p-4", props.className)}>
      <span className="text-xs font-medium text-muted-foreground">{props.label}</span>
      <span className="text-lg font-semibold tabular-nums text-foreground">{props.value}</span>
    </div>
  );
}

export function StudioEmptyState(props: { title: string; text: string; className?: string }) {
  return (
    <div className={cn("grid min-h-80 place-items-center px-6 text-center", props.className)}>
      <div className="grid max-w-md gap-2">
        <h2 className="m-0 font-heading text-lg font-medium text-foreground">{props.title}</h2>
        <p className="m-0 text-base leading-6 text-muted-foreground">{props.text}</p>
      </div>
    </div>
  );
}

export function StudioStatusBadge({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-4xl bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function StudioTabs({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("grid gap-1 rounded-lg bg-muted p-1", className)} {...props} />;
}
