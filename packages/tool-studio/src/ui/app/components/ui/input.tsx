import type * as React from "react";
import { cn } from "@/lib/utils";

export function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      className={cn(
        "h-9 w-full rounded-lg border border-input bg-card/90 px-3 text-foreground outline-none transition duration-200 placeholder:text-muted-foreground/65 focus:border-muted-foreground/60 focus:ring-2 focus:ring-muted-foreground/20",
        className,
      )}
      {...props}
    />
  );
}
