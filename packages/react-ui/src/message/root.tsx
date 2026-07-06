import type { UIMessage } from "@anvia/react";
import { forwardRef, type ReactNode } from "react";

import { useMessage } from "../contexts";
import { type PrimitiveProps, renderPrimitive } from "../primitives";

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

  return renderPrimitive(
    "article",
    {
      ...props,
      children: renderedChildren,
      "data-anvia-message": "",
      "data-anvia-message-id": message.id,
      "data-role": message.role,
    } as PrimitiveProps<"article">,
    ref,
  );
});

const MessageContent = forwardRef<HTMLDivElement, PrimitiveProps<"div">>(
  function MessageContent(props, ref) {
    return renderPrimitive(
      "div",
      {
        ...props,
        "data-anvia-message-content": "",
      } as PrimitiveProps<"div">,
      ref,
    );
  },
);

export { MessageContent, MessageRoot };
