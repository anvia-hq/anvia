import { SelectionToolbarCopy, SelectionToolbarQuote, SelectionToolbarRoot } from "./parts";

export const SelectionToolbar = {
  Root: SelectionToolbarRoot,
  Quote: SelectionToolbarQuote,
  Copy: SelectionToolbarCopy,
} as const;

export type { SelectionToolbarContextValue, SelectionToolbarSelection } from "../contexts";
export { useSelectionToolbar } from "../contexts";
