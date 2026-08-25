import type * as React from "react";
import { cn } from "@/lib/utils";

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "min-h-16 w-full resize-none rounded-lg border border-input bg-transparent px-2.5 py-2 text-base leading-6 text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-50 dark:bg-transparent dark:disabled:bg-muted",
        className,
      )}
      {...props}
    />
  );
}
