import {
  GraphExplorerEmpty,
  GraphExplorerNodes,
  GraphExplorerRefresh,
  GraphExplorerRoot,
  GraphExplorerSearch,
  GraphExplorerStatus,
  GraphExplorerViewport,
  GraphExplorerNodeExpand,
  GraphExplorerNodeRoot,
  GraphExplorerNodeTrigger,
} from "./parts";

export const GraphExplorerPrimitive = {
  Root: GraphExplorerRoot,
  Viewport: GraphExplorerViewport,
  Search: GraphExplorerSearch,
  Nodes: GraphExplorerNodes,
  Empty: GraphExplorerEmpty,
  Status: GraphExplorerStatus,
  Refresh: GraphExplorerRefresh,
} as const;

export const GraphExplorerNodePrimitive = {
  Root: GraphExplorerNodeRoot,
  Trigger: GraphExplorerNodeTrigger,
  Expand: GraphExplorerNodeExpand,
} as const;

export type {
  GraphExplorerController,
  GraphExplorerExpandNodeOptions,
  GraphExplorerNodeContextValue,
  GraphExplorerProviderProps,
  GraphExplorerStatus,
} from "../contexts/graph-explorer";
export {
  GraphExplorerProvider,
  useGraphExplorerContext,
  useGraphExplorerNode,
} from "../contexts/graph-explorer";
export { graphExplorerNodeLabel } from "./helpers";
export type { GraphExplorerNodeRootProps } from "./parts";
