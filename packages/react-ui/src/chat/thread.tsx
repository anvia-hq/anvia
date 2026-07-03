import type { UIMessage } from "@anvia/react";
import {
  forwardRef,
  type MouseEvent,
  type ReactNode,
  type UIEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  InternalMessageProvider,
  InternalThreadProvider,
  type ThreadContextValue,
  useChatContext,
  useThread,
} from "../contexts";
import { Message } from "../message/index";
import { composeRefs, type PrimitiveProps, renderPrimitive } from "../primitives";

type ThreadMessagesChildren = ReactNode | ((message: UIMessage) => ReactNode);

const ThreadRoot = forwardRef<HTMLDivElement, PrimitiveProps<"div">>(
  function ThreadRoot(props, ref) {
    const chat = useChatContext();
    const viewportRef = useRef<HTMLElement | null>(null);
    const [atBottom, setAtBottom] = useState(true);
    const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
      const viewport = viewportRef.current;
      if (viewport === null) {
        return;
      }
      viewport.scrollTo({ top: viewport.scrollHeight, behavior });
    }, []);
    const thread = useMemo<ThreadContextValue>(
      () => ({ viewportRef, atBottom, setAtBottom, scrollToBottom }),
      [atBottom, scrollToBottom],
    );

    return (
      <InternalThreadProvider value={thread}>
        {renderPrimitive(
          "div",
          {
            ...props,
            "data-anvia-thread": "",
            "data-state": chat.status,
          } as PrimitiveProps<"div">,
          ref,
        )}
      </InternalThreadProvider>
    );
  },
);

type ThreadViewportProps = PrimitiveProps<"div"> & {
  autoScroll?: boolean;
};

const ThreadViewport = forwardRef<HTMLDivElement, ThreadViewportProps>(function ThreadViewport(
  { autoScroll = true, onScroll, ...props },
  ref,
) {
  const chat = useChatContext();
  const thread = useThread();
  const messages = chat.messages;
  const composedRef = useMemo(
    () =>
      composeRefs<HTMLDivElement>(ref, (node) => {
        thread.viewportRef.current = node;
      }),
    [ref, thread.viewportRef],
  );

  useEffect(() => {
    const hasMessages = messages.length > 0;
    if (autoScroll && (thread.atBottom || !hasMessages)) {
      thread.scrollToBottom("auto");
    }
  }, [autoScroll, messages, thread]);

  const handleScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      onScroll?.(event);
      const node = event.currentTarget;
      const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
      thread.setAtBottom(distanceFromBottom < 8);
    },
    [onScroll, thread],
  );

  return renderPrimitive(
    "div",
    {
      ...props,
      onScroll: handleScroll,
      "data-anvia-thread-viewport": "",
      "data-state": thread.atBottom ? "bottom" : "away",
    } as PrimitiveProps<"div">,
    composedRef,
  );
});

const ThreadEmpty = forwardRef<HTMLDivElement, PrimitiveProps<"div">>(
  function ThreadEmpty(props, ref) {
    const chat = useChatContext();
    if (chat.messages.length > 0) {
      return null;
    }

    return renderPrimitive(
      "div",
      {
        ...props,
        "data-anvia-thread-empty": "",
      } as PrimitiveProps<"div">,
      ref,
    );
  },
);

type ThreadMessagesProps = Omit<PrimitiveProps<"div">, "children"> & {
  children?: ThreadMessagesChildren;
};

const ThreadMessages = forwardRef<HTMLDivElement, ThreadMessagesProps>(function ThreadMessages(
  { children, ...props },
  ref,
) {
  const chat = useChatContext();

  return renderPrimitive(
    "div",
    {
      ...props,
      children: chat.messages.map((message) => (
        <InternalMessageProvider key={message.id} message={message}>
          {typeof children === "function" ? children(message) : (children ?? defaultMessage())}
        </InternalMessageProvider>
      )),
      "data-anvia-thread-messages": "",
    } as PrimitiveProps<"div">,
    ref,
  );
});

const ThreadScrollToBottom = forwardRef<HTMLButtonElement, PrimitiveProps<"button">>(
  function ThreadScrollToBottom({ onClick, ...props }, ref) {
    const thread = useThread();
    const disabled = props.disabled ?? thread.atBottom;

    const handleClick = useCallback(
      (event: MouseEvent<HTMLButtonElement>) => {
        onClick?.(event);
        if (event.defaultPrevented || disabled) {
          return;
        }
        thread.scrollToBottom();
      },
      [disabled, onClick, thread],
    );

    return renderPrimitive(
      "button",
      {
        ...props,
        children: props.children ?? "Scroll to bottom",
        disabled,
        onClick: handleClick,
        type: props.type ?? "button",
        "data-anvia-scroll-to-bottom": "",
        "data-state": thread.atBottom ? "bottom" : "away",
      } as PrimitiveProps<"button">,
      ref,
    );
  },
);

function defaultMessage(): ReactNode {
  return (
    <Message.Root>
      <Message.Content>
        <Message.Parts />
      </Message.Content>
      <Message.Actions />
    </Message.Root>
  );
}

export const Thread = {
  Root: ThreadRoot,
  Viewport: ThreadViewport,
  Messages: ThreadMessages,
  Empty: ThreadEmpty,
  ScrollToBottom: ThreadScrollToBottom,
} as const;
