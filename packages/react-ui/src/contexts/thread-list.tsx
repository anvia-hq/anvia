import { createContext, createElement, type ReactElement, type ReactNode, useContext } from "react";

export type ThreadListRecord = {
  id: string;
  title?: string;
  createdAt?: string | Date;
  updatedAt?: string | Date;
  archived?: boolean;
  metadata?: unknown;
};

export type ThreadListController = {
  threads: ThreadListRecord[];
  activeThreadId?: string;
  status?: "idle" | "loading" | "error";
  error?: unknown;
  createThread(): Promise<void> | void;
  switchThread(threadId: string): Promise<void> | void;
  archiveThread?(threadId: string): Promise<void> | void;
  unarchiveThread?(threadId: string): Promise<void> | void;
  deleteThread?(threadId: string): Promise<void> | void;
};

export type ThreadListItemContextValue = {
  thread: ThreadListRecord;
  active: boolean;
};

export type ThreadListProviderProps = {
  controller: ThreadListController;
  children?: ReactNode;
};

const ThreadListContext = createContext<ThreadListController | undefined>(undefined);
const ThreadListItemContext = createContext<ThreadListItemContextValue | undefined>(undefined);

export function ThreadListProvider({
  controller,
  children,
}: ThreadListProviderProps): ReactElement {
  return createElement(ThreadListContext.Provider, { value: controller }, children);
}

export function InternalThreadListItemProvider({
  value,
  children,
}: {
  value: ThreadListItemContextValue;
  children?: ReactNode;
}): ReactElement {
  return createElement(ThreadListItemContext.Provider, { value }, children);
}

export function useThreadList(): ThreadListController {
  const value = useContext(ThreadListContext);
  if (value === undefined) {
    throw new Error("ThreadList primitives must be used inside ThreadListProvider.");
  }
  return value;
}

export function useThreadListItem(): ThreadListItemContextValue {
  const value = useContext(ThreadListItemContext);
  if (value === undefined) {
    throw new Error("ThreadListItem primitives must be used inside ThreadList.Items.");
  }
  return value;
}
