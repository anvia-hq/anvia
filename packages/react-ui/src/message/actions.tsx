import { forwardRef, type MouseEvent, useCallback, useEffect, useRef, useState } from "react";

import { useChatContext, useMessage } from "../contexts";
import { messageText } from "../format";
import { type PrimitiveProps, renderPrimitive } from "../primitives";

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
  const previousTextRef = useRef(text);
  const disabled = props.disabled ?? text.length === 0;

  useEffect(() => {
    if (previousTextRef.current !== text) {
      previousTextRef.current = text;
      setCopyState("idle");
    }
  }, [text]);

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

export { MessageActions, MessageCopy, MessageRegenerate };
