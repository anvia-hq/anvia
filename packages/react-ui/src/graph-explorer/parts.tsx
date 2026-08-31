import type { GraphExploreNode } from "@anvia/graph";
import { forwardRef, type ChangeEvent, type MouseEvent, type ReactNode, useCallback } from "react";

import {
  InternalGraphExplorerNodeProvider,
  type GraphExplorerController,
  type GraphExplorerExpandNodeOptions,
  type GraphExplorerNodeContextValue,
  useGraphExplorerContext,
  useGraphExplorerNode,
  useOptionalGraphExplorerNode,
} from "../contexts";
import { type PrimitiveProps, renderPrimitive } from "../primitives";
import { graphExplorerNodeLabel } from "./helpers";

export const GraphExplorerRoot = forwardRef<HTMLDivElement, PrimitiveProps<"div">>(
  function GraphExplorerRoot(props, ref) {
    const explorer = useGraphExplorerContext();
    const truncated = explorer.truncated.nodes || explorer.truncated.relationships;
    return renderPrimitive(
      "div",
      {
        ...props,
        "aria-busy": explorer.status === "loading",
        "data-role": "graph-explorer",
        "data-state": explorer.status,
        "data-truncated": truncated ? "true" : "false",
      } as PrimitiveProps<"div">,
      ref,
    );
  },
);

export const GraphExplorerSearch = forwardRef<HTMLInputElement, PrimitiveProps<"input">>(
  function GraphExplorerSearch({ onChange, ...props }, ref) {
    const explorer = useGraphExplorerContext();
    const handleChange = useCallback(
      (event: ChangeEvent<HTMLInputElement>) => {
        onChange?.(event);
        if (!event.defaultPrevented) explorer.setQuery(event.currentTarget.value);
      },
      [explorer, onChange],
    );
    return renderPrimitive(
      "input",
      {
        ...props,
        "aria-label": props["aria-label"] ?? "Search graph",
        "data-state": explorer.query.length === 0 ? "empty" : "populated",
        onChange: handleChange,
        type: props.type ?? "search",
        value: explorer.query,
      } as PrimitiveProps<"input">,
      ref,
    );
  },
);

export const GraphExplorerViewport = forwardRef<HTMLDivElement, PrimitiveProps<"div">>(
  function GraphExplorerViewport(props, ref) {
    return renderPrimitive(
      "div",
      { ...props, "data-role": "graph-explorer-viewport" } as PrimitiveProps<"div">,
      ref,
    );
  },
);

type GraphExplorerNodesChildren =
  | ReactNode
  | ((node: GraphExploreNode, state: GraphExplorerNodeContextValue) => ReactNode);

type GraphExplorerNodesProps = Omit<PrimitiveProps<"div">, "children"> & {
  children?: GraphExplorerNodesChildren;
  keepMounted?: boolean;
};

export const GraphExplorerNodes = forwardRef<HTMLDivElement, GraphExplorerNodesProps>(
  function GraphExplorerNodes({ children, keepMounted = false, ...props }, ref) {
    const explorer = useGraphExplorerContext();
    const empty = explorer.nodes.length === 0;
    if (empty && !keepMounted) return null;
    return renderPrimitive(
      "div",
      {
        ...props,
        children: explorer.nodes.map((node) => {
          const state: GraphExplorerNodeContextValue = {
            node,
            selected: node.id === explorer.selectedNodeId,
            matched: explorer.matchedNodeIds.has(node.id),
          };
          return (
            <InternalGraphExplorerNodeProvider key={node.id} value={state}>
              {typeof children === "function"
                ? children(node, state)
                : (children ?? (
                    <GraphExplorerNodeRoot>
                      <GraphExplorerNodeTrigger />
                    </GraphExplorerNodeRoot>
                  ))}
            </InternalGraphExplorerNodeProvider>
          );
        }),
        "data-state": empty ? "empty" : "populated",
        role: props.role ?? "list",
      } as PrimitiveProps<"div">,
      ref,
    );
  },
);

export const GraphExplorerEmpty = forwardRef<HTMLDivElement, PrimitiveProps<"div">>(
  function GraphExplorerEmpty(props, ref) {
    const explorer = useGraphExplorerContext();
    if (explorer.nodes.length > 0 || explorer.status === "loading") return null;
    return renderPrimitive(
      "div",
      { ...props, children: props.children ?? "No graph nodes." } as PrimitiveProps<"div">,
      ref,
    );
  },
);

type GraphExplorerStatusChildren = ReactNode | ((explorer: GraphExplorerController) => ReactNode);
type GraphExplorerStatusProps = Omit<PrimitiveProps<"div">, "children"> & {
  children?: GraphExplorerStatusChildren;
};

export const GraphExplorerStatus = forwardRef<HTMLDivElement, GraphExplorerStatusProps>(
  function GraphExplorerStatus({ children, ...props }, ref) {
    const explorer = useGraphExplorerContext();
    const content =
      typeof children === "function" ? children(explorer) : (children ?? statusText(explorer));
    return renderPrimitive(
      "div",
      {
        ...props,
        children: content,
        "data-state": explorer.status,
        role: props.role ?? "status",
      } as PrimitiveProps<"div">,
      ref,
    );
  },
);

export const GraphExplorerRefresh = forwardRef<HTMLButtonElement, PrimitiveProps<"button">>(
  function GraphExplorerRefresh({ onClick, ...props }, ref) {
    const explorer = useGraphExplorerContext();
    const disabled = props.disabled ?? explorer.status === "loading";
    const handleClick = useAsyncAction(onClick, disabled, explorer.refresh);
    return renderPrimitive(
      "button",
      {
        ...props,
        children: props.children ?? "Refresh graph",
        disabled,
        onClick: handleClick,
        type: props.type ?? "button",
      } as PrimitiveProps<"button">,
      ref,
    );
  },
);

export type GraphExplorerNodeRootProps = PrimitiveProps<"div"> & { nodeId?: string };

export const GraphExplorerNodeRoot = forwardRef<HTMLDivElement, GraphExplorerNodeRootProps>(
  function GraphExplorerNodeRoot({ nodeId, ...props }, ref) {
    const explorer = useGraphExplorerContext();
    const inherited = useOptionalGraphExplorerNode();
    const node = nodeId === undefined ? inherited?.node : explorer.nodeById.get(nodeId);
    if (node === undefined) {
      throw new Error(
        nodeId === undefined
          ? "GraphExplorerNodePrimitive.Root requires a nodeId outside GraphExplorerPrimitive.Nodes."
          : `Graph explorer node ${nodeId} is not loaded.`,
      );
    }
    const state: GraphExplorerNodeContextValue = {
      node,
      selected: node.id === explorer.selectedNodeId,
      matched: explorer.matchedNodeIds.has(node.id),
    };
    return (
      <InternalGraphExplorerNodeProvider value={state}>
        {renderPrimitive(
          "div",
          {
            ...props,
            "data-match": state.matched ? "matched" : "unmatched",
            "data-node-id": state.node.id,
            "data-node-type": state.node.type,
            "data-state": state.selected ? "selected" : "unselected",
            role: props.role ?? (inherited === undefined ? undefined : "listitem"),
          } as PrimitiveProps<"div">,
          ref,
        )}
      </InternalGraphExplorerNodeProvider>
    );
  },
);

export const GraphExplorerNodeTrigger = forwardRef<HTMLButtonElement, PrimitiveProps<"button">>(
  function GraphExplorerNodeTrigger({ onClick, ...props }, ref) {
    const explorer = useGraphExplorerContext();
    const state = useGraphExplorerNode();
    const handleClick = useCallback(
      (event: MouseEvent<HTMLButtonElement>) => {
        onClick?.(event);
        if (!event.defaultPrevented && !props.disabled) explorer.selectNode(state.node.id);
      },
      [explorer, onClick, props.disabled, state.node.id],
    );
    return renderPrimitive(
      "button",
      {
        ...props,
        children: props.children ?? graphExplorerNodeLabel(state.node),
        onClick: handleClick,
        type: props.type ?? "button",
        "aria-pressed": state.selected,
      } as PrimitiveProps<"button">,
      ref,
    );
  },
);

type GraphExplorerNodeExpandOptions = Omit<GraphExplorerExpandNodeOptions, "abortSignal">;
type GraphExplorerNodeExpandProps = PrimitiveProps<"button"> & {
  options?: GraphExplorerNodeExpandOptions;
};

export const GraphExplorerNodeExpand = forwardRef<HTMLButtonElement, GraphExplorerNodeExpandProps>(
  function GraphExplorerNodeExpand({ onClick, options, ...props }, ref) {
    const explorer = useGraphExplorerContext();
    const state = useGraphExplorerNode();
    const disabled = props.disabled ?? explorer.status === "loading";
    const expand = useCallback(
      () => explorer.expandNode(state.node.id, options),
      [explorer, options, state.node.id],
    );
    const handleClick = useAsyncAction(onClick, disabled, expand);
    return renderPrimitive(
      "button",
      {
        ...props,
        children: props.children ?? "Expand",
        disabled,
        onClick: handleClick,
        type: props.type ?? "button",
      } as PrimitiveProps<"button">,
      ref,
    );
  },
);

function useAsyncAction(
  onClick: ((event: MouseEvent<HTMLButtonElement>) => void) | undefined,
  disabled: boolean,
  action: () => Promise<unknown>,
) {
  return useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      onClick?.(event);
      if (event.defaultPrevented || disabled) return;
      void action().catch(() => undefined);
    },
    [action, disabled, onClick],
  );
}

function statusText(explorer: GraphExplorerController): ReactNode {
  if (explorer.status === "loading") return "Loading graph.";
  if (explorer.status === "error") return "Graph exploration failed.";
  return `${explorer.nodes.length} nodes, ${explorer.relationships.length} relationships.`;
}
