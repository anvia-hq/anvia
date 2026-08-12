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

export function StudioPageHeader(
  props: {
    title: string;
    description: string;
    action?: React.ReactNode;
  } & Omit<React.ComponentProps<"header">, "children">,
) {
  const { title, description, action, className, ...headerProps } = props;
  return (
    <header
      className={cn(
        "flex flex-col gap-3 px-4 pt-4 sm:flex-row sm:items-end sm:justify-between md:px-6 md:pt-6",
        className,
      )}
      {...headerProps}
    >
      <div className="grid min-w-0 gap-1">
        <h1 className="m-0 font-heading text-2xl font-medium tracking-tight">{title}</h1>
        <p className="m-0 max-w-[68ch] text-sm text-muted-foreground">{description}</p>
      </div>
      {action}
    </header>
  );
}

export function StudioPageContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div className={cn("min-h-0 min-w-0 px-4 pb-4 pt-6 md:px-6 md:pb-6", className)} {...props} />
  );
}

export function StudioHeaderMetric(props: {
  label: string;
  value: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-8 items-center gap-2 rounded-md border border-border/70 px-2.5 text-xs font-medium text-muted-foreground",
        props.className,
      )}
    >
      <span className="font-medium tabular-nums text-foreground">{props.value}</span>
      {props.label}
    </span>
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

export function StudioEmptyState(props: {
  title: string;
  text: string;
  action?: React.ReactNode;
  size?: "default" | "compact";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex w-full min-w-0 flex-1 flex-col items-center justify-center gap-4 rounded-xl border-dashed p-6 text-center text-balance",
        props.size === "compact" ? "min-h-32" : "min-h-64",
        props.className,
      )}
    >
      <div className="flex max-w-sm flex-col items-center gap-2">
        <h2 className="m-0 font-heading text-sm font-medium tracking-tight text-foreground">
          {props.title}
        </h2>
        <p className="m-0 text-sm/relaxed text-muted-foreground">{props.text}</p>
      </div>
      {props.action ? (
        <div className="flex w-full max-w-sm min-w-0 flex-col items-center gap-2.5 text-sm text-balance">
          {props.action}
        </div>
      ) : null}
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
