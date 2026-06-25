import type * as React from "react";
import { cn } from "@/lib/utils";

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "min-h-9 w-full resize-none rounded-lg border border-input bg-card/90 px-3 py-2.5 leading-6 text-foreground outline-none transition duration-200 placeholder:text-muted-foreground/65 focus:border-muted-foreground/60 focus:ring-2 focus:ring-muted-foreground/20",
        className,
      )}
      {...props}
    />
  );
}
