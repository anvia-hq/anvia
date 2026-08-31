import type { GraphExploreNode, GraphSchemaLike } from "@anvia/graph";
import type {
  GraphExplorerController,
  GraphExplorerExpandNodeOptions,
  GraphExplorerStatus,
} from "@anvia/react/graph-explorer";
import { createContext, createElement, type ReactElement, type ReactNode, useContext } from "react";

export type { GraphExplorerController, GraphExplorerExpandNodeOptions, GraphExplorerStatus };

export type GraphExplorerProviderProps<Schema extends GraphSchemaLike = GraphSchemaLike> = {
  controller: GraphExplorerController<Schema>;
  children?: ReactNode;
};

export type GraphExplorerNodeContextValue = {
  node: GraphExploreNode;
  selected: boolean;
  matched: boolean;
};

const GraphExplorerContext = createContext<GraphExplorerController | undefined>(undefined);
const GraphExplorerNodeContext = createContext<GraphExplorerNodeContextValue | undefined>(
  undefined,
);

export function GraphExplorerProvider<Schema extends GraphSchemaLike = GraphSchemaLike>({
  controller,
  children,
}: GraphExplorerProviderProps<Schema>): ReactElement {
  return createElement(
    GraphExplorerContext.Provider,
    { value: controller as unknown as GraphExplorerController },
    children,
  );
}

export function InternalGraphExplorerNodeProvider({
  value,
  children,
}: {
  value: GraphExplorerNodeContextValue;
  children?: ReactNode;
}): ReactElement {
  return createElement(GraphExplorerNodeContext.Provider, { value }, children);
}

export function useGraphExplorerContext<
  Schema extends GraphSchemaLike = GraphSchemaLike,
>(): GraphExplorerController<Schema> {
  const value = useContext(GraphExplorerContext);
  if (value === undefined) {
    throw new Error("Graph explorer primitives must be used inside GraphExplorerProvider.");
  }
  return value as unknown as GraphExplorerController<Schema>;
}

export function useGraphExplorerNode(): GraphExplorerNodeContextValue {
  const value = useContext(GraphExplorerNodeContext);
  if (value === undefined) {
    throw new Error(
      "Graph explorer node primitives must be used inside GraphExplorerNodePrimitive.Root or GraphExplorerPrimitive.Nodes.",
    );
  }
  return value;
}

export function useOptionalGraphExplorerNode(): GraphExplorerNodeContextValue | undefined {
  return useContext(GraphExplorerNodeContext);
}
