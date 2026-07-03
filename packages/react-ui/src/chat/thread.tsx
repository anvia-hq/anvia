import type { ChatSuggestion, UIMessage, UseChatStatus } from "@anvia/react";
import {
  Fragment,
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
type ThreadSuggestionChildren = ReactNode | ((suggestion: ChatSuggestion) => ReactNode);

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

const ThreadViewportFooter = forwardRef<HTMLDivElement, PrimitiveProps<"div">>(
  function ThreadViewportFooter(props, ref) {
    return renderPrimitive(
      "div",
      {
        ...props,
        "data-anvia-thread-viewport-footer": "",
      } as PrimitiveProps<"div">,
      ref,
    );
  },
);

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

type ThreadStatusProps = Omit<PrimitiveProps<"div">, "children"> & {
  children?: ReactNode | ((status: UseChatStatus) => ReactNode);
};

const ThreadStatus = forwardRef<HTMLDivElement, ThreadStatusProps>(function ThreadStatus(
  { children, ...props },
  ref,
) {
  const chat = useChatContext();
  const renderedChildren = typeof children === "function" ? children(chat.status) : children;

  return renderPrimitive(
    "div",
    {
      ...props,
      children: renderedChildren ?? chat.status,
      "data-anvia-thread-status": "",
      "data-state": chat.status,
    } as PrimitiveProps<"div">,
    ref,
  );
});

const ThreadLoading = forwardRef<HTMLDivElement, PrimitiveProps<"div">>(
  function ThreadLoading(props, ref) {
    const chat = useChatContext();
    if (chat.status !== "streaming") {
      return null;
    }

    return renderPrimitive(
      "div",
      {
        ...props,
        children: props.children ?? "Loading",
        "data-anvia-thread-loading": "",
      } as PrimitiveProps<"div">,
      ref,
    );
  },
);

type ThreadErrorProps = Omit<PrimitiveProps<"div">, "children"> & {
  children?: ReactNode | ((error: unknown) => ReactNode);
};

const ThreadError = forwardRef<HTMLDivElement, ThreadErrorProps>(function ThreadError(
  { children, ...props },
  ref,
) {
  const chat = useChatContext();
  if (chat.status !== "error" && chat.error === undefined) {
    return null;
  }
  const renderedChildren = typeof children === "function" ? children(chat.error) : children;

  return renderPrimitive(
    "div",
    {
      ...props,
      children: renderedChildren ?? errorMessage(chat.error),
      "data-anvia-thread-error": "",
      role: props.role ?? "alert",
    } as PrimitiveProps<"div">,
    ref,
  );
});

type ThreadMessagesProps = Omit<PrimitiveProps<"div">, "children"> & {
  children?: ThreadMessagesChildren;
  keepMounted?: boolean;
};

const ThreadMessages = forwardRef<HTMLDivElement, ThreadMessagesProps>(function ThreadMessages(
  { children, keepMounted = true, ...props },
  ref,
) {
  const chat = useChatContext();
  const empty = chat.messages.length === 0;
  if (empty && !keepMounted) {
    return null;
  }

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
      "data-empty": empty ? "" : undefined,
    } as PrimitiveProps<"div">,
    ref,
  );
});

type ThreadSuggestionsProps = Omit<PrimitiveProps<"div">, "children"> & {
  children?: ThreadSuggestionChildren;
  keepMounted?: boolean;
};

const ThreadSuggestions = forwardRef<HTMLDivElement, ThreadSuggestionsProps>(
  function ThreadSuggestions({ children, keepMounted = false, ...props }, ref) {
    const chat = useChatContext();
    const suggestions = chat.suggestions ?? [];
    const empty = suggestions.length === 0;
    if (empty && !keepMounted) {
      return null;
    }

    return renderPrimitive(
      "div",
      {
        ...props,
        children: suggestions.map((suggestion) =>
          typeof children === "function" ? (
            <Fragment key={suggestion.id}>{children(suggestion)}</Fragment>
          ) : (
            <ThreadSuggestion key={suggestion.id} suggestion={suggestion}>
              {children}
            </ThreadSuggestion>
          ),
        ),
        "data-anvia-thread-suggestions": "",
        "data-empty": empty ? "" : undefined,
      } as PrimitiveProps<"div">,
      ref,
    );
  },
);

type ThreadSuggestionProps = Omit<PrimitiveProps<"button">, "children"> & {
  children?: ReactNode;
  prompt?: string;
  suggestion?: ChatSuggestion;
};

const ThreadSuggestion = forwardRef<HTMLButtonElement, ThreadSuggestionProps>(
  function ThreadSuggestion({ onClick, prompt, suggestion, ...props }, ref) {
    const chat = useChatContext();
    const suggestionPrompt = prompt ?? suggestion?.prompt ?? "";
    const disabled =
      props.disabled ?? (suggestionPrompt.length === 0 || chat.status === "streaming");

    const handleClick = useCallback(
      (event: MouseEvent<HTMLButtonElement>) => {
        onClick?.(event);
        if (event.defaultPrevented || disabled) {
          return;
        }
        void chat.sendMessage(suggestionPrompt);
      },
      [chat, disabled, onClick, suggestionPrompt],
    );

    return renderPrimitive(
      "button",
      {
        ...props,
        children: props.children ?? suggestion?.label ?? suggestionPrompt,
        disabled,
        onClick: handleClick,
        type: props.type ?? "button",
        "data-anvia-thread-suggestion": "",
        "data-state": disabled ? "disabled" : "enabled",
      } as PrimitiveProps<"button">,
      ref,
    );
  },
);

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

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "Something went wrong.";
}

export const Thread = {
  Root: ThreadRoot,
  Viewport: ThreadViewport,
  ViewportFooter: ThreadViewportFooter,
  Messages: ThreadMessages,
  Empty: ThreadEmpty,
  Status: ThreadStatus,
  Loading: ThreadLoading,
  Error: ThreadError,
  Suggestions: ThreadSuggestions,
  Suggestion: ThreadSuggestion,
  ScrollToBottom: ThreadScrollToBottom,
} as const;
