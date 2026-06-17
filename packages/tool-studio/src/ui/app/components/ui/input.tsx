import type * as React from "react";
import { cn } from "@/lib/utils";

export function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      className={cn(
        "h-9 w-full rounded-lg border border-input bg-card/90 px-3 text-foreground outline-none shadow-inner shadow-black/10 transition duration-200 placeholder:text-muted-foreground/65 focus:border-ring focus:ring-2 focus:ring-ring/20",
        className,
      )}
      {...props}
    />
  );
}
