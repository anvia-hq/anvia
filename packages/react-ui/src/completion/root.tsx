import { forwardRef, type ReactNode } from "react";

import { useCompletionContext } from "../contexts";
import { type PrimitiveProps, renderPrimitive } from "../primitives";

type CompletionOutputChildren = ReactNode | ((completion: string) => ReactNode);

const CompletionRoot = forwardRef<HTMLDivElement, PrimitiveProps<"div">>(
  function CompletionRoot(props, ref) {
    const completion = useCompletionContext();
    return renderPrimitive(
      "div",
      {
        ...props,
        "data-anvia-completion": "",
        "data-state": completion.status,
      } as PrimitiveProps<"div">,
      ref,
    );
  },
);

type CompletionOutputProps = PrimitiveProps<"div"> & {
  children?: CompletionOutputChildren;
};

const CompletionOutput = forwardRef<HTMLDivElement, CompletionOutputProps>(
  function CompletionOutput({ children, ...props }, ref) {
    const completion = useCompletionContext();
    const renderedChildren =
      typeof children === "function" ? children(completion.completion) : children;

    return renderPrimitive(
      "div",
      {
        ...props,
        children: renderedChildren ?? completion.completion,
        "data-anvia-completion-output": "",
      } as PrimitiveProps<"div">,
      ref,
    );
  },
);

export { CompletionOutput, CompletionRoot };
