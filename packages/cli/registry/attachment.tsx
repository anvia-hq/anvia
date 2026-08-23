"use client";

import { AttachmentPrimitive } from "@anvia/react-ui";
import type { ComponentProps } from "react";

export function Attachment({
  className,
  ...props
}: ComponentProps<typeof AttachmentPrimitive.Root>) {
  return (
    <AttachmentPrimitive.Root
      className={[
        "flex min-w-0 items-center gap-3 rounded-xl border bg-card px-3 py-2 text-card-foreground shadow-sm",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    >
      <AttachmentPrimitive.Preview className="size-10 shrink-0 overflow-hidden rounded-lg bg-muted [&_img]:size-full [&_img]:object-cover" />
      <AttachmentPrimitive.Name className="min-w-0 flex-1 truncate text-sm" />
      <AttachmentPrimitive.Remove className="rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50">
        Remove
      </AttachmentPrimitive.Remove>
    </AttachmentPrimitive.Root>
  );
}
