"use client";

import { MessagePrimitive } from "@anvia/react-ui";
import type { ComponentProps } from "react";

export function ToolFallback({
  className,
  ...props
}: ComponentProps<typeof MessagePrimitive.Tool>) {
  return (
    <MessagePrimitive.Tool
      className={["my-2 overflow-hidden rounded-xl border bg-muted/30 text-sm", className]
        .filter(Boolean)
        .join(" ")}
      {...props}
    >
      <div className="flex items-center justify-between border-b px-3 py-2">
        <MessagePrimitive.ToolName className="font-medium" />
        <MessagePrimitive.ToolStatus className="text-xs text-muted-foreground" />
      </div>
      <details className="group">
        <summary className="cursor-pointer px-3 py-2 text-xs text-muted-foreground">
          Details
        </summary>
        <div className="grid gap-3 border-t p-3">
          <MessagePrimitive.ToolInput className="overflow-auto whitespace-pre-wrap rounded-lg bg-background p-3 text-xs" />
          <MessagePrimitive.ToolOutput className="overflow-auto whitespace-pre-wrap rounded-lg bg-background p-3 text-xs" />
          <MessagePrimitive.ToolError className="rounded-lg bg-destructive/10 p-3 text-destructive" />
        </div>
      </details>
    </MessagePrimitive.Tool>
  );
}
