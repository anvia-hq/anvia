import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-sm text-sm font-semibold shadow-none transition duration-200 ease-out active:translate-y-px disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-ring/35 focus-visible:ring-offset-0 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "border border-primary/80 bg-primary text-primary-foreground shadow-sm shadow-primary/15 hover:border-primary hover:bg-primary/90",
        ghost:
          "border border-transparent bg-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground",
        destructive:
          "border border-destructive bg-destructive text-destructive-foreground hover:bg-destructive/90",
        secondary:
          "border border-border/80 bg-secondary text-secondary-foreground shadow-xs hover:border-primary/35 hover:bg-accent hover:text-accent-foreground",
      },
      size: {
        default: "h-9 px-3",
        icon: "h-8 w-8 p-0",
        sm: "h-8 px-2.5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  };

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { buttonVariants };
