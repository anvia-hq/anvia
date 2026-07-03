import type { UIMessagePart } from "@anvia/react";
import { forwardRef, type ReactNode } from "react";

import { InternalMessagePartProvider, useMessage, useMessagePart } from "../contexts";
import { stringifyValue } from "../format";
import { type PrimitiveProps, renderPrimitive } from "../primitives";

type MessagePartChildren = ReactNode | ((part: UIMessagePart) => ReactNode);
export type MessagePartsFilter = (part: UIMessagePart) => boolean;
export type MessageToolPart = Extract<UIMessagePart, { type: "tool" }>;
type MessageToolChildren = ReactNode | ((part: MessageToolPart) => ReactNode);
export type MessageToolRenderWhen = "always" | "pending" | "settled";

type MessagePartsProps = Omit<PrimitiveProps<"div">, "children"> & {
  children?: MessagePartChildren;
  filter?: MessagePartsFilter;
};

const MessageParts = forwardRef<HTMLDivElement, MessagePartsProps>(function MessageParts(
  { children, filter, ...props },
  ref,
) {
  const { message } = useMessage();
  const parts = filter === undefined ? message.parts : message.parts.filter(filter);

  return renderPrimitive(
    "div",
    {
      ...props,
      children: parts.map((part) => (
        <InternalMessagePartProvider key={part.id} part={part}>
          {typeof children === "function" ? children(part) : (children ?? <MessagePart />)}
        </InternalMessagePartProvider>
      )),
      "data-anvia-message-parts": "",
    } as PrimitiveProps<"div">,
    ref,
  );
});

type MessagePartProps = Omit<PrimitiveProps<"div">, "children"> & {
  children?: MessagePartChildren;
};

const MessagePart = forwardRef<HTMLDivElement, MessagePartProps>(function MessagePart(
  { children, ...props },
  ref,
) {
  const { part } = useMessagePart();
  const renderedChildren =
    typeof children === "function" ? children(part) : (children ?? defaultPart(part));

  return renderPrimitive(
    "div",
    {
      ...props,
      children: renderedChildren,
      "data-anvia-part": "",
      "data-part": part.type,
    } as PrimitiveProps<"div">,
    ref,
  );
});

const MessageText = forwardRef<HTMLSpanElement, PrimitiveProps<"span">>(
  function MessageText(props, ref) {
    const { part } = useMessagePart();
    if (part.type !== "text") {
      return null;
    }

    return renderPrimitive(
      "span",
      {
        ...props,
        children: props.children ?? part.text,
        "data-anvia-text": "",
      } as PrimitiveProps<"span">,
      ref,
    );
  },
);

const MessageReasoning = forwardRef<HTMLDetailsElement, PrimitiveProps<"details">>(
  function MessageReasoning(props, ref) {
    const { part } = useMessagePart();
    if (part.type !== "reasoning") {
      return null;
    }

    return renderPrimitive(
      "details",
      {
        ...props,
        children: props.children ?? (
          <>
            <summary>Reasoning</summary>
            <pre>{part.text}</pre>
          </>
        ),
        "data-anvia-reasoning": "",
      } as PrimitiveProps<"details">,
      ref,
    );
  },
);

type MessageToolProps = Omit<PrimitiveProps<"div">, "children"> & {
  children?: MessageToolChildren;
  renderWhen?: MessageToolRenderWhen;
};

const MessageTool = forwardRef<HTMLDivElement, MessageToolProps>(function MessageTool(
  { children, renderWhen = "always", ...props },
  ref,
) {
  const { part } = useMessagePart();
  if (part.type !== "tool" || !shouldRenderTool(part, renderWhen)) {
    return null;
  }
  const renderedChildren =
    typeof children === "function" ? children(part) : (children ?? defaultToolContent(part));

  return renderPrimitive(
    "div",
    {
      ...props,
      children: renderedChildren,
      "data-anvia-tool": "",
      "data-state": part.state,
    } as PrimitiveProps<"div">,
    ref,
  );
});

const MessageData = forwardRef<HTMLPreElement, PrimitiveProps<"pre">>(
  function MessageData(props, ref) {
    const { part } = useMessagePart();
    if (part.type !== "data") {
      return null;
    }

    return renderPrimitive(
      "pre",
      {
        ...props,
        children: props.children ?? stringifyValue(part.data),
        "data-anvia-data": "",
        "data-name": part.name,
      } as PrimitiveProps<"pre">,
      ref,
    );
  },
);

const MessageError = forwardRef<HTMLDivElement, PrimitiveProps<"div">>(
  function MessageError(props, ref) {
    const { part } = useMessagePart();
    if (part.type !== "error") {
      return null;
    }

    return renderPrimitive(
      "div",
      {
        ...props,
        children: props.children ?? part.error.message,
        "data-anvia-error": "",
        role: props.role ?? "alert",
      } as PrimitiveProps<"div">,
      ref,
    );
  },
);

function defaultPart(part: UIMessagePart): ReactNode {
  if (part.type === "text") {
    return <MessageText />;
  }
  if (part.type === "reasoning") {
    return <MessageReasoning />;
  }
  if (part.type === "tool") {
    return <MessageTool />;
  }
  if (part.type === "data") {
    return <MessageData />;
  }
  return <MessageError />;
}

function defaultToolContent(part: MessageToolPart): ReactNode {
  return (
    <>
      <div data-anvia-tool-name="">{part.toolName}</div>
      {part.input !== undefined ? (
        <pre data-anvia-tool-input="">{stringifyValue(part.input)}</pre>
      ) : null}
      {part.output !== undefined ? (
        <pre data-anvia-tool-output="">{stringifyValue(part.output)}</pre>
      ) : null}
      {part.error !== undefined ? (
        <div data-anvia-tool-error="" role="alert">
          {part.error.message}
        </div>
      ) : null}
    </>
  );
}

function shouldRenderTool(part: MessageToolPart, renderWhen: MessageToolRenderWhen): boolean {
  if (renderWhen === "always") {
    return true;
  }
  if (renderWhen === "pending") {
    return part.state === "input-streaming" || part.state === "input-available";
  }
  return part.state === "output-available" || part.state === "error";
}

export {
  MessageData,
  MessageError,
  MessagePart,
  MessageParts,
  MessageReasoning,
  MessageText,
  MessageTool,
};
