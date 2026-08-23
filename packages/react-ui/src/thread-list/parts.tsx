import {
  forwardRef,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useMemo,
  useRef,
} from "react";

import {
  InternalThreadListItemProvider,
  InternalThreadListRootProvider,
  type ThreadListRecord,
  useInternalThreadListRoot,
  useThreadList,
  useThreadListItem,
} from "../contexts";
import { composeRefs, type PrimitiveProps, renderPrimitive } from "../primitives";

type ThreadListRootProps = PrimitiveProps<"div">;

const ThreadListRoot = forwardRef<HTMLDivElement, ThreadListRootProps>(function ThreadListRoot(
  { onKeyDown, ...props },
  ref,
) {
  const threadList = useThreadList();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const newButtonRef = useRef<HTMLButtonElement | null>(null);
  const itemElements = useRef(new Map<string, HTMLDivElement>());
  const triggerElements = useRef(new Map<string, HTMLButtonElement>());
  const registerItem = useCallback((threadId: string, element: HTMLDivElement | null) => {
    if (element === null) itemElements.current.delete(threadId);
    else itemElements.current.set(threadId, element);
  }, []);
  const registerTrigger = useCallback((threadId: string, element: HTMLButtonElement | null) => {
    if (element === null) triggerElements.current.delete(threadId);
    else triggerElements.current.set(threadId, element);
  }, []);
  const rootContext = useMemo(
    () => ({
      rootRef,
      newButtonRef,
      itemElements,
      triggerElements,
      registerItem,
      registerTrigger,
    }),
    [registerItem, registerTrigger],
  );
  const composedRef = useMemo(
    () =>
      composeRefs<HTMLDivElement>(ref, (node) => {
        rootRef.current = node;
      }),
    [ref],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      onKeyDown?.(event);
      if (event.defaultPrevented || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        return;
      }
      const triggers = orderedEnabledTriggers(rootContext);
      if (triggers.length === 0) {
        return;
      }
      event.preventDefault();
      const activeElement = document.activeElement;
      const currentIndex =
        activeElement instanceof HTMLButtonElement ? triggers.indexOf(activeElement) : -1;
      const nextIndex = nextTriggerIndex(event.key, currentIndex, triggers.length);
      triggers[nextIndex]?.focus();
    },
    [onKeyDown, rootContext],
  );

  return (
    <InternalThreadListRootProvider value={rootContext}>
      {renderPrimitive(
        "div",
        {
          ...props,
          onKeyDown: handleKeyDown,
          "data-state": threadList.status ?? "idle",
        } as PrimitiveProps<"div">,
        composedRef,
      )}
    </InternalThreadListRootProvider>
  );
});

const ThreadListNew = forwardRef<HTMLButtonElement, PrimitiveProps<"button">>(
  function ThreadListNew({ onClick, ...props }, ref) {
    const threadList = useThreadList();
    const root = useInternalThreadListRoot();
    const composedRef = useMemo(
      () =>
        composeRefs<HTMLButtonElement>(ref, (node) => {
          root.newButtonRef.current = node;
        }),
      [ref, root.newButtonRef],
    );

    const handleClick = useCallback(
      (event: MouseEvent<HTMLButtonElement>) => {
        onClick?.(event);
        if (event.defaultPrevented || props.disabled) {
          return;
        }
        void threadList.createThread();
      },
      [onClick, props.disabled, threadList],
    );

    return renderPrimitive(
      "button",
      {
        ...props,
        children: props.children ?? "New chat",
        onClick: handleClick,
        type: props.type ?? "button",
        "data-state": props.disabled ? "disabled" : "enabled",
      } as PrimitiveProps<"button">,
      composedRef,
    );
  },
);

type ThreadListItemsChildren = ReactNode | ((thread: ThreadListRecord) => ReactNode);

type ThreadListItemsProps = Omit<PrimitiveProps<"div">, "children"> & {
  archived?: boolean;
  children?: ThreadListItemsChildren;
  keepMounted?: boolean;
};

const ThreadListItems = forwardRef<HTMLDivElement, ThreadListItemsProps>(function ThreadListItems(
  { archived = false, children, keepMounted = false, ...props },
  ref,
) {
  const threadList = useThreadList();
  const threads = threadList.threads.filter((thread) => Boolean(thread.archived) === archived);
  const empty = threads.length === 0;
  if (empty && !keepMounted) {
    return null;
  }

  return renderPrimitive(
    "div",
    {
      ...props,
      children: threads.map((thread) => (
        <InternalThreadListItemProvider
          key={thread.id}
          value={{ thread, active: thread.id === threadList.activeThreadId }}
        >
          {typeof children === "function" ? children(thread) : (children ?? <DefaultThreadItem />)}
        </InternalThreadListItemProvider>
      )),
      "data-state": empty ? "empty" : "populated",
    } as PrimitiveProps<"div">,
    ref,
  );
});

type ThreadListEmptyProps = PrimitiveProps<"div"> & {
  archived?: boolean;
};

const ThreadListEmpty = forwardRef<HTMLDivElement, ThreadListEmptyProps>(function ThreadListEmpty(
  { archived = false, ...props },
  ref,
) {
  const threadList = useThreadList();
  const hasVisibleThreads = threadList.threads.some(
    (thread) => Boolean(thread.archived) === archived,
  );
  if (hasVisibleThreads) {
    return null;
  }

  return renderPrimitive(
    "div",
    {
      ...props,
      children: props.children ?? "No conversations.",
    } as PrimitiveProps<"div">,
    ref,
  );
});

const ThreadListItemRoot = forwardRef<HTMLDivElement, PrimitiveProps<"div">>(
  function ThreadListItemRoot(props, ref) {
    const item = useThreadListItem();
    const root = useInternalThreadListRoot();
    const composedRef = useMemo(
      () => composeRefs<HTMLDivElement>(ref, (node) => root.registerItem(item.thread.id, node)),
      [item.thread.id, ref, root],
    );

    return renderPrimitive(
      "div",
      {
        ...props,
        "data-state": item.active ? "active" : "inactive",
      } as PrimitiveProps<"div">,
      composedRef,
    );
  },
);

const ThreadListItemTrigger = forwardRef<HTMLButtonElement, PrimitiveProps<"button">>(
  function ThreadListItemTrigger({ onClick, ...props }, ref) {
    const threadList = useThreadList();
    const item = useThreadListItem();
    const root = useInternalThreadListRoot();
    const disabled = props.disabled ?? false;
    const composedRef = useMemo(
      () =>
        composeRefs<HTMLButtonElement>(ref, (node) => root.registerTrigger(item.thread.id, node)),
      [item.thread.id, ref, root],
    );

    const handleClick = useCallback(
      (event: MouseEvent<HTMLButtonElement>) => {
        onClick?.(event);
        if (event.defaultPrevented || disabled) {
          return;
        }
        void threadList.switchThread(item.thread.id);
      },
      [disabled, item.thread.id, onClick, threadList],
    );

    return renderPrimitive(
      "button",
      {
        ...props,
        children: props.children ?? <ThreadListItemTitle />,
        disabled,
        onClick: handleClick,
        type: props.type ?? "button",
        "aria-current": item.active ? "true" : undefined,
        "data-state": disabled ? "disabled" : "enabled",
      } as PrimitiveProps<"button">,
      composedRef,
    );
  },
);

type ThreadListItemTitleProps = PrimitiveProps<"span"> & {
  fallback?: ReactNode;
};

const ThreadListItemTitle = forwardRef<HTMLSpanElement, ThreadListItemTitleProps>(
  function ThreadListItemTitle({ fallback = "New chat", ...props }, ref) {
    const { thread } = useThreadListItem();

    return renderPrimitive(
      "span",
      {
        ...props,
        children: props.children ?? thread.title ?? fallback,
      } as PrimitiveProps<"span">,
      ref,
    );
  },
);

type ThreadListItemActionKey = "archiveThread" | "unarchiveThread" | "deleteThread";
function createThreadListItemAction(action: ThreadListItemActionKey, defaultLabel: string) {
  return forwardRef<HTMLButtonElement, PrimitiveProps<"button">>(function ThreadListItemAction(
    { onClick, ...props },
    ref,
  ) {
    const threadList = useThreadList();
    const { thread } = useThreadListItem();
    const root = useInternalThreadListRoot();
    const actionHandler = threadList[action];
    const disabled = props.disabled ?? actionHandler === undefined;

    const handleClick = useCallback(
      (event: MouseEvent<HTMLButtonElement>) => {
        onClick?.(event);
        if (event.defaultPrevented || disabled) {
          return;
        }
        focusAfterThreadItemRemoval(thread.id, root);
        void actionHandler?.(thread.id);
      },
      [actionHandler, disabled, onClick, root, thread.id],
    );

    return renderPrimitive(
      "button",
      {
        ...props,
        children: props.children ?? defaultLabel,
        disabled,
        onClick: handleClick,
        type: props.type ?? "button",
        "data-state": disabled ? "disabled" : "enabled",
      } as PrimitiveProps<"button">,
      ref,
    );
  });
}

const ThreadListItemArchive = createThreadListItemAction("archiveThread", "Archive");
const ThreadListItemUnarchive = createThreadListItemAction("unarchiveThread", "Unarchive");
const ThreadListItemDelete = createThreadListItemAction("deleteThread", "Delete");

function DefaultThreadItem(): ReactNode {
  return (
    <ThreadListItemRoot>
      <ThreadListItemTrigger />
    </ThreadListItemRoot>
  );
}

function nextTriggerIndex(key: string, currentIndex: number, triggerCount: number): number {
  if (key === "Home") {
    return 0;
  }
  if (key === "End") {
    return triggerCount - 1;
  }
  if (currentIndex === -1) {
    return key === "ArrowUp" ? triggerCount - 1 : 0;
  }
  if (key === "ArrowUp") {
    return (currentIndex - 1 + triggerCount) % triggerCount;
  }
  return (currentIndex + 1) % triggerCount;
}

function focusAfterThreadItemRemoval(
  threadId: string,
  rootContext: ReturnType<typeof useInternalThreadListRoot>,
): void {
  const root = rootContext.rootRef.current;
  const currentItem = rootContext.itemElements.current.get(threadId);
  if (
    root === null ||
    currentItem === undefined ||
    !currentItem.contains(root.ownerDocument.activeElement)
  ) {
    return;
  }

  const triggers = orderedEnabledTriggers(rootContext);
  const currentTrigger = rootContext.triggerElements.current.get(threadId);
  const currentIndex = currentTrigger === undefined ? -1 : triggers.indexOf(currentTrigger);
  const remainingTriggers = triggers.filter((trigger) => !currentItem.contains(trigger));
  const fallback = rootContext.newButtonRef.current;
  const focusTarget =
    remainingTriggers[Math.min(Math.max(currentIndex, 0), remainingTriggers.length - 1)] ??
    fallback ??
    root;

  if (focusTarget === root && !root.hasAttribute("tabindex")) {
    root.tabIndex = -1;
  }
  focusTarget.focus();
}

function orderedEnabledTriggers(
  rootContext: ReturnType<typeof useInternalThreadListRoot>,
): HTMLButtonElement[] {
  return [...rootContext.triggerElements.current.values()]
    .filter((trigger) => trigger.isConnected && !trigger.disabled)
    .sort((left, right) =>
      left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
    );
}

export {
  ThreadListEmpty,
  ThreadListItemArchive,
  ThreadListItemDelete,
  ThreadListItemRoot,
  ThreadListItems,
  ThreadListItemTitle,
  ThreadListItemTrigger,
  ThreadListItemUnarchive,
  ThreadListNew,
  ThreadListRoot,
};
