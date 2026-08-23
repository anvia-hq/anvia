import type { UseChatResult } from "@anvia/react";
import { forwardRef, type ReactNode } from "react";

import { type PrimitiveProps, renderPrimitive } from "./primitives";

type ContextUsage = NonNullable<UseChatResult["contextUsage"]>;

export type ContextMeterProps = Omit<PrimitiveProps<"div">, "children"> & {
  usage?: ContextUsage;
  display?: "remaining" | "used";
  children?: ReactNode | ((usage: ContextUsage) => ReactNode);
};

export const ContextMeterPrimitive = forwardRef<HTMLDivElement, ContextMeterProps>(
  function ContextMeter({ usage, display = "remaining", children, ...props }, ref) {
    if (usage === undefined) {
      return null;
    }

    const percent = display === "remaining" ? usage.remainingPercent : usage.usedPercent;
    const roundedPercent = Math.round(percent);
    const label = `${roundedPercent}% context ${display === "remaining" ? "left" : "used"}`;
    const content =
      typeof children === "function"
        ? children(usage)
        : (children ?? (
            <>
              <span>{label}</span>
              <span aria-hidden="true">
                <span style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
              </span>
            </>
          ));

    return renderPrimitive(
      "div",
      {
        ...props,
        children: content,
        "aria-label": props["aria-label"] ?? label,
        "aria-valuemax": 100,
        "aria-valuemin": 0,
        "aria-valuenow": roundedPercent,
        role: props.role ?? "progressbar",
      } as PrimitiveProps<"div">,
      ref,
    );
  },
);
