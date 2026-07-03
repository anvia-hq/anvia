import type { UIMessage, UIMessagePart } from "@anvia/react";
import { forwardRef, type MouseEvent, type ReactNode, useCallback, useState } from "react";

import {
  InternalMessagePartProvider,
  messageText,
  type PrimitiveProps,
  renderPrimitive,
  stringifyValue,
  useChatContext,
  useMessage,
  useMessagePart,
} from "./internal";

type MessageChildren = ReactNode | ((message: UIMessage) => ReactNode);
type MessagePartChildren = ReactNode | ((part: UIMessagePart) => ReactNode);
export type MessagePartsFilter = (part: UIMessagePart) => boolean;
export type MessageToolPart = Extract<UIMessagePart, { type: "tool" }>;
type MessageToolChildren = ReactNode | ((part: MessageToolPart) => ReactNode);
export type MessageToolRenderWhen = "always" | "pending" | "settled";

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

const MessageActions = forwardRef<HTMLDivElement, PrimitiveProps<"div">>(
  function MessageActions(props, ref) {
    return renderPrimitive(
      "div",
      {
        ...props,
        children: props.children ?? (
          <>
            <MessageCopy />
            <MessageRegenerate />
          </>
        ),
        "data-anvia-message-actions": "",
      } as PrimitiveProps<"div">,
      ref,
    );
  },
);

type MessageCopyState = "idle" | "copied" | "error";

const MessageCopy = forwardRef<HTMLButtonElement, PrimitiveProps<"button">>(function MessageCopy(
  { onClick, ...props },
  ref,
) {
  const { message } = useMessage();
  const [copyState, setCopyState] = useState<MessageCopyState>("idle");
  const text = messageText(message);
  const disabled = props.disabled ?? text.length === 0;

  const handleClick = useCallback(
    async (event: MouseEvent<HTMLButtonElement>) => {
      onClick?.(event);
      if (event.defaultPrevented || disabled) {
        return;
      }
      const writeText = navigator.clipboard?.writeText;
      if (writeText === undefined) {
        setCopyState("error");
        return;
      }
      try {
        await writeText.call(navigator.clipboard, text);
        setCopyState("copied");
      } catch {
        setCopyState("error");
      }
    },
    [disabled, onClick, text],
  );

  return renderPrimitive(
    "button",
    {
      ...props,
      children: props.children ?? "Copy",
      disabled,
      onClick: handleClick,
      type: props.type ?? "button",
      "data-anvia-copy": "",
      "data-state": copyState,
    } as PrimitiveProps<"button">,
    ref,
  );
});

const MessageRegenerate = forwardRef<HTMLButtonElement, PrimitiveProps<"button">>(
  function MessageRegenerate({ onClick, ...props }, ref) {
    const chat = useChatContext();
    const { message } = useMessage();
    const latestAssistantMessage = [...chat.messages]
      .reverse()
      .find((item) => item.role === "assistant");
    const disabled =
      props.disabled ??
      (chat.status === "streaming" ||
        message.role !== "assistant" ||
        latestAssistantMessage?.id !== message.id);

    const handleClick = useCallback(
      (event: MouseEvent<HTMLButtonElement>) => {
        onClick?.(event);
        if (event.defaultPrevented || disabled) {
          return;
        }
        void chat.regenerate();
      },
      [chat, disabled, onClick],
    );

    return renderPrimitive(
      "button",
      {
        ...props,
        children: props.children ?? "Regenerate",
        disabled,
        onClick: handleClick,
        type: props.type ?? "button",
        "data-anvia-regenerate": "",
        "data-state": disabled ? "disabled" : "idle",
      } as PrimitiveProps<"button">,
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

export const Message = {
  Root: MessageRoot,
  Content: MessageContent,
  Parts: MessageParts,
  Part: MessagePart,
  Text: MessageText,
  Reasoning: MessageReasoning,
  Tool: MessageTool,
  Data: MessageData,
  Error: MessageError,
  Actions: MessageActions,
  Copy: MessageCopy,
  Regenerate: MessageRegenerate,
} as const;

export type { MessageContextValue, MessagePartContextValue } from "./internal";
export { useChatContext, useMessage, useMessagePart };
