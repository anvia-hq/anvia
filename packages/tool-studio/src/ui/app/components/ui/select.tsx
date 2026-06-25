import { ArrowDown01Icon, CheckIcon } from "@hugeicons/core-free-icons";
import * as SelectPrimitive from "@radix-ui/react-select";
import type * as React from "react";
import { cn } from "@/lib/utils";
import { StudioIcon } from "./icon";

export const Select = SelectPrimitive.Root;
export const SelectValue = SelectPrimitive.Value;

export function SelectTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      className={cn(
        "flex h-9 w-full items-center justify-between rounded-lg border border-input bg-card/90 px-3 text-sm text-foreground outline-none transition duration-200 hover:border-muted-foreground/45 focus:border-muted-foreground/60 focus:ring-2 focus:ring-muted-foreground/20 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <StudioIcon icon={ArrowDown01Icon} className="h-4 w-4 opacity-60" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

export function SelectContent({
  className,
  children,
  position = "popper",
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        position={position}
        className={cn(
          "z-50 max-h-80 min-w-[8rem] overflow-hidden rounded-xl border border-border/90 bg-popover/98 text-popover-foreground shadow-xl shadow-black/45 backdrop-blur",
          className,
        )}
        {...props}
      >
        <SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

export function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      className={cn(
        "relative flex min-h-8 cursor-default select-none items-center rounded-lg py-1.5 pl-8 pr-2 text-sm outline-none transition data-[disabled]:pointer-events-none data-[highlighted]:bg-muted/65 data-[highlighted]:text-foreground data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    >
      <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <StudioIcon icon={CheckIcon} className="h-4 w-4" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}
