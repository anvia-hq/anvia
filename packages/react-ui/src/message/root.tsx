import type { UIMessage } from "@anvia/client";
import { forwardRef, type ReactNode, useCallback, useMemo } from "react";

import { useMessage } from "../contexts";
import { composeRefs, type PrimitiveProps, renderPrimitive } from "../primitives";
import { registerMessageElement } from "./elements";

type MessageChildren = ReactNode | ((message: UIMessage) => ReactNode);

type MessageRootProps = Omit<PrimitiveProps<"article">, "children"> & {
  children?: MessageChildren;
};

const MessageRoot = forwardRef<HTMLElement, MessageRootProps>(function MessageRoot(
  { children, ...props },
  ref,
) {
  const { message } = useMessage();
  const renderedChildren = typeof children === "function" ? children(message) : children;
  const registerElement = useCallback(
    (element: HTMLElement | null) => {
      if (element !== null) registerMessageElement(element, message.id);
    },
    [message.id],
  );
  const composedRef = useMemo(() => composeRefs(ref, registerElement), [ref, registerElement]);

  return renderPrimitive(
    "article",
    {
      ...props,
      children: renderedChildren,
      "data-role": message.role,
    } as PrimitiveProps<"article">,
    composedRef,
  );
});

const MessageContent = forwardRef<HTMLDivElement, PrimitiveProps<"div">>(
  function MessageContent(props, ref) {
    return renderPrimitive(
      "div",
      {
        ...props,
      } as PrimitiveProps<"div">,
      ref,
    );
  },
);

export { MessageContent, MessageRoot };
