import {
  forwardRef,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useCallback,
} from "react";

import {
  InternalThreadListItemProvider,
  type ThreadListRecord,
  useThreadList,
  useThreadListItem,
} from "../contexts";
import { type PrimitiveProps, renderPrimitive } from "../primitives";

type ThreadListRootProps = PrimitiveProps<"div">;

const ThreadListRoot = forwardRef<HTMLDivElement, ThreadListRootProps>(function ThreadListRoot(
  { onKeyDown, ...props },
  ref,
) {
  const threadList = useThreadList();

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      onKeyDown?.(event);
      if (event.defaultPrevented || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        return;
      }
      const triggers = Array.from(
        event.currentTarget.querySelectorAll<HTMLButtonElement>(
          "[data-anvia-thread-list-trigger]:not(:disabled)",
        ),
      );
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
    [onKeyDown],
  );

  return renderPrimitive(
    "div",
    {
      ...props,
      onKeyDown: handleKeyDown,
      "data-anvia-thread-list": "",
      "data-state": threadList.status ?? "idle",
    } as PrimitiveProps<"div">,
    ref,
  );
});

const ThreadListNew = forwardRef<HTMLButtonElement, PrimitiveProps<"button">>(
  function ThreadListNew({ onClick, ...props }, ref) {
    const threadList = useThreadList();

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
        "data-anvia-thread-list-new": "",
        "data-state": props.disabled ? "disabled" : "enabled",
      } as PrimitiveProps<"button">,
      ref,
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
      "data-anvia-thread-list-items": "",
      "data-archived": archived ? "" : undefined,
      "data-empty": empty ? "" : undefined,
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
      "data-anvia-thread-list-empty": "",
    } as PrimitiveProps<"div">,
    ref,
  );
});

const ThreadListItemRoot = forwardRef<HTMLDivElement, PrimitiveProps<"div">>(
  function ThreadListItemRoot(props, ref) {
    const item = useThreadListItem();

    return renderPrimitive(
      "div",
      {
        ...props,
        "data-anvia-thread-list-item": "",
        "data-active": item.active ? "" : undefined,
        "data-thread-id": item.thread.id,
      } as PrimitiveProps<"div">,
      ref,
    );
  },
);

const ThreadListItemTrigger = forwardRef<HTMLButtonElement, PrimitiveProps<"button">>(
  function ThreadListItemTrigger({ onClick, ...props }, ref) {
    const threadList = useThreadList();
    const item = useThreadListItem();
    const disabled = props.disabled ?? false;

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
        "data-anvia-thread-list-trigger": "",
        "data-state": disabled ? "disabled" : "enabled",
      } as PrimitiveProps<"button">,
      ref,
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
        "data-anvia-thread-list-title": "",
      } as PrimitiveProps<"span">,
      ref,
    );
  },
);

type ThreadListItemActionKey = "archiveThread" | "unarchiveThread" | "deleteThread";
type ThreadListItemActionDataAttribute =
  | "data-anvia-thread-list-archive"
  | "data-anvia-thread-list-unarchive"
  | "data-anvia-thread-list-delete";

function createThreadListItemAction(
  action: ThreadListItemActionKey,
  defaultLabel: string,
  dataAttribute: ThreadListItemActionDataAttribute,
) {
  return forwardRef<HTMLButtonElement, PrimitiveProps<"button">>(function ThreadListItemAction(
    { onClick, ...props },
    ref,
  ) {
    const threadList = useThreadList();
    const { thread } = useThreadListItem();
    const actionHandler = threadList[action];
    const disabled = props.disabled ?? actionHandler === undefined;

    const handleClick = useCallback(
      (event: MouseEvent<HTMLButtonElement>) => {
        onClick?.(event);
        if (event.defaultPrevented || disabled) {
          return;
        }
        focusAfterThreadItemRemoval(event.currentTarget);
        void actionHandler?.(thread.id);
      },
      [actionHandler, disabled, onClick, thread.id],
    );

    return renderPrimitive(
      "button",
      {
        ...props,
        children: props.children ?? defaultLabel,
        disabled,
        onClick: handleClick,
        type: props.type ?? "button",
        [dataAttribute]: "",
        "data-state": disabled ? "disabled" : "enabled",
      } as PrimitiveProps<"button">,
      ref,
    );
  });
}

const ThreadListItemArchive = createThreadListItemAction(
  "archiveThread",
  "Archive",
  "data-anvia-thread-list-archive",
);
const ThreadListItemUnarchive = createThreadListItemAction(
  "unarchiveThread",
  "Unarchive",
  "data-anvia-thread-list-unarchive",
);
const ThreadListItemDelete = createThreadListItemAction(
  "deleteThread",
  "Delete",
  "data-anvia-thread-list-delete",
);

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

function focusAfterThreadItemRemoval(actionButton: HTMLButtonElement): void {
  const root = actionButton.closest<HTMLElement>("[data-anvia-thread-list]");
  const currentItem = actionButton.closest<HTMLElement>("[data-anvia-thread-list-item]");
  if (
    root === null ||
    currentItem === null ||
    !currentItem.contains(root.ownerDocument.activeElement)
  ) {
    return;
  }

  const triggers = Array.from(
    root.querySelectorAll<HTMLButtonElement>("[data-anvia-thread-list-trigger]:not(:disabled)"),
  );
  const currentTrigger = currentItem.querySelector<HTMLButtonElement>(
    "[data-anvia-thread-list-trigger]",
  );
  const currentIndex = currentTrigger === null ? -1 : triggers.indexOf(currentTrigger);
  const remainingTriggers = triggers.filter((trigger) => !currentItem.contains(trigger));
  const fallback = root.querySelector<HTMLButtonElement>(
    "[data-anvia-thread-list-new]:not(:disabled)",
  );
  const focusTarget =
    remainingTriggers[Math.min(Math.max(currentIndex, 0), remainingTriggers.length - 1)] ??
    fallback ??
    root;

  if (focusTarget === root && !root.hasAttribute("tabindex")) {
    root.tabIndex = -1;
  }
  focusTarget.focus();
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
