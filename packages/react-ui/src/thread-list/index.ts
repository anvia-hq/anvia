import {
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
} from "./parts";

export const ThreadList = {
  Root: ThreadListRoot,
  New: ThreadListNew,
  Items: ThreadListItems,
  Empty: ThreadListEmpty,
} as const;

export const ThreadListItem = {
  Root: ThreadListItemRoot,
  Trigger: ThreadListItemTrigger,
  Title: ThreadListItemTitle,
  Archive: ThreadListItemArchive,
  Unarchive: ThreadListItemUnarchive,
  Delete: ThreadListItemDelete,
} as const;

export type {
  ThreadListController,
  ThreadListItemContextValue,
  ThreadListProviderProps,
  ThreadListRecord,
} from "../contexts";
export { ThreadListProvider, useThreadList, useThreadListItem } from "../contexts";
