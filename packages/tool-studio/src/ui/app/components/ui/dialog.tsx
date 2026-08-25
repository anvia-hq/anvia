import * as DialogPrimitive from "@radix-ui/react-dialog";
import type * as React from "react";
import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[var(--sb-overlay)] backdrop-blur-xs" />
      <DialogPrimitive.Content
        className={cn(
          "fixed top-1/2 left-1/2 z-50 grid w-[min(420px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg bg-popover p-4 text-base text-popover-foreground ring-1 ring-[var(--sb-popover-ring)] outline-none",
          className,
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("grid gap-1.5", className)} {...props} />;
}

export function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-lg border-t bg-muted p-4 sm:flex-row sm:justify-end",
        className,
      )}
      {...props}
    />
  );
}

export function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn("font-heading text-lg leading-none font-medium", className)}
      {...props}
    />
  );
}

export function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn("text-base leading-6 text-muted-foreground", className)}
      {...props}
    />
  );
}
