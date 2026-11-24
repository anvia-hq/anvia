import {
  GraphExplorerEmpty,
  GraphExplorerNodeExpand,
  GraphExplorerNodeRoot,
  GraphExplorerNodes,
  GraphExplorerNodeTrigger,
  GraphExplorerRefresh,
  GraphExplorerRoot,
  GraphExplorerSearch,
  GraphExplorerStatus,
  GraphExplorerViewport,
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
  GraphExplorerNodeContextValue,
  GraphExplorerProviderProps,
} from "../contexts/graph-explorer";
export {
  GraphExplorerProvider,
  useGraphExplorerContext,
  useGraphExplorerNode,
} from "../contexts/graph-explorer";
export { graphExplorerNodeLabel } from "./helpers";
export type { GraphExplorerNodeRootProps } from "./parts";
export {
  graphExplorerNodeMatches,
  mergeGraphExploreResults,
  useGraphExplorer,
  type GraphExplorerController,
  type GraphExplorerExpandNodeOptions,
  type GraphExplorerStatus,
  type UseGraphExplorerOptions,
} from "./use-graph-explorer";
