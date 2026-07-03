import type { UIMessage } from "@anvia/react";
import {
  type ChangeEvent,
  type FormEvent,
  forwardRef,
  type KeyboardEvent,
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
  ChatProvider,
  type ComposerContextValue,
  composeRefs,
  InternalComposerProvider,
  InternalMessageProvider,
  InternalThreadProvider,
  type PrimitiveProps,
  renderPrimitive,
  type ThreadContextValue,
  useChatContext,
  useComposer,
  useThread,
} from "./internal";
import { Message } from "./message";

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

const ComposerRoot = forwardRef<HTMLFormElement, PrimitiveProps<"form">>(function ComposerRoot(
  { onSubmit, ...props },
  ref,
) {
  const chat = useChatContext();
  const [input, setInput] = useState("");
  const canSubmit = input.trim().length > 0 && chat.status !== "streaming";
  const canStop = chat.status === "streaming";

  const submit = useCallback(async () => {
    const prompt = input;
    if (prompt.trim().length === 0 || chat.status === "streaming") {
      return;
    }
    setInput("");
    await chat.sendMessage(prompt);
  }, [chat, input]);

  const value = useMemo<ComposerContextValue>(
    () => ({
      input,
      setInput,
      submit,
      stop: chat.stop,
      status: chat.status,
      canSubmit,
      canStop,
    }),
    [canStop, canSubmit, chat.status, chat.stop, input, submit],
  );

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      (onSubmit as ((event: FormEvent<HTMLFormElement>) => void) | undefined)?.(event);
      if (event.defaultPrevented) {
        return;
      }
      event.preventDefault();
      void submit();
    },
    [onSubmit, submit],
  );

  return (
    <InternalComposerProvider value={value}>
      {renderPrimitive(
        "form",
        {
          ...props,
          onSubmit: handleSubmit,
          "data-anvia-composer": "",
          "data-state": chat.status,
        } as PrimitiveProps<"form">,
        ref,
      )}
    </InternalComposerProvider>
  );
});

const ComposerInput = forwardRef<HTMLTextAreaElement, PrimitiveProps<"textarea">>(
  function ComposerInput({ onChange, onKeyDown, ...props }, ref) {
    const composer = useComposer();

    const handleChange = useCallback(
      (event: ChangeEvent<HTMLTextAreaElement>) => {
        onChange?.(event);
        if (!event.defaultPrevented) {
          composer.setInput(event.currentTarget.value);
        }
      },
      [composer, onChange],
    );

    const handleKeyDown = useCallback(
      (event: KeyboardEvent<HTMLTextAreaElement>) => {
        onKeyDown?.(event);
        if (
          event.defaultPrevented ||
          event.key !== "Enter" ||
          event.shiftKey ||
          event.nativeEvent.isComposing
        ) {
          return;
        }
        event.preventDefault();
        void composer.submit();
      },
      [composer, onKeyDown],
    );

    return renderPrimitive(
      "textarea",
      {
        ...props,
        "aria-label": props["aria-label"] ?? "Message",
        disabled: props.disabled ?? composer.status === "streaming",
        onChange: handleChange,
        onKeyDown: handleKeyDown,
        value: composer.input,
        "data-anvia-composer-input": "",
      } as PrimitiveProps<"textarea">,
      ref,
    );
  },
);

const ComposerSubmit = forwardRef<HTMLButtonElement, PrimitiveProps<"button">>(
  function ComposerSubmit(props, ref) {
    const composer = useComposer();
    const disabled = props.disabled ?? !composer.canSubmit;

    return renderPrimitive(
      "button",
      {
        ...props,
        children: props.children ?? "Send",
        disabled,
        type: props.type ?? "submit",
        "data-anvia-submit": "",
        "data-state": disabled ? "disabled" : "enabled",
      } as PrimitiveProps<"button">,
      ref,
    );
  },
);

const ComposerStop = forwardRef<HTMLButtonElement, PrimitiveProps<"button">>(function ComposerStop(
  { onClick, ...props },
  ref,
) {
  const composer = useComposer();
  const disabled = props.disabled ?? !composer.canStop;

  const handleClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      onClick?.(event);
      if (event.defaultPrevented || disabled) {
        return;
      }
      composer.stop();
    },
    [composer, disabled, onClick],
  );

  return renderPrimitive(
    "button",
    {
      ...props,
      children: props.children ?? "Stop",
      disabled,
      onClick: handleClick,
      type: props.type ?? "button",
      "data-anvia-stop": "",
      "data-state": disabled ? "disabled" : "enabled",
    } as PrimitiveProps<"button">,
    ref,
  );
});

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

export const Composer = {
  Root: ComposerRoot,
  Input: ComposerInput,
  Submit: ComposerSubmit,
  Stop: ComposerStop,
} as const;

export type {
  ChatController,
  ChatProviderProps,
  ComposerContextValue,
  ThreadContextValue,
} from "./internal";
export { ChatProvider, useChatContext, useComposer, useThread };
