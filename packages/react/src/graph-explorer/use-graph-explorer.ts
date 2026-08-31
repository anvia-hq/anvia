import type {
  GraphExploreExpandOptions,
  GraphExploreNode,
  GraphExploreOptions,
  GraphExploreRelationship,
  GraphExploreResult,
  GraphExplorer,
  GraphSchemaLike,
} from "@anvia/graph";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const emptyResult: GraphExploreResult = {
  nodes: [],
  relationships: [],
  truncated: { nodes: false, relationships: false },
};

export type GraphExplorerStatus = "idle" | "loading" | "ready" | "error";

export type GraphExplorerExpandNodeOptions<Schema extends GraphSchemaLike = GraphSchemaLike> = Omit<
  GraphExploreExpandOptions<Schema>,
  "mode" | "nodeIds"
>;

export type GraphExplorerController<Schema extends GraphSchemaLike = GraphSchemaLike> = {
  nodes: readonly GraphExploreNode[];
  nodeById: ReadonlyMap<string, GraphExploreNode>;
  relationships: readonly GraphExploreRelationship[];
  truncated: GraphExploreResult["truncated"];
  selectedNodeId: string | undefined;
  selectedNode: GraphExploreNode | undefined;
  query: string;
  matchedNodeIds: ReadonlySet<string>;
  status: GraphExplorerStatus;
  error: unknown | undefined;
  explore(options: GraphExploreOptions<Schema>): Promise<GraphExploreResult | undefined>;
  expandNode(
    nodeId: string,
    options?: GraphExplorerExpandNodeOptions<Schema>,
  ): Promise<GraphExploreResult | undefined>;
  refresh(): Promise<GraphExploreResult | undefined>;
  selectNode(nodeId: string | undefined): void;
  setQuery(query: string): void;
  stop(): void;
  reset(): void;
};

export type UseGraphExplorerOptions<Schema extends GraphSchemaLike = GraphSchemaLike> = {
  explore: GraphExplorer<Schema>["explore"];
  initialResult?: GraphExploreResult;
  initialQuery?: string;
  searchText?: (node: GraphExploreNode) => string;
};

type ExpansionDefaults<Schema extends GraphSchemaLike> = Pick<
  GraphExplorerExpandNodeOptions<Schema>,
  "nodeTypes" | "relationships" | "includeProvenance" | "maxNodes" | "maxRelationships"
>;

export function useGraphExplorer<Schema extends GraphSchemaLike = GraphSchemaLike>(
  options: UseGraphExplorerOptions<Schema>,
): GraphExplorerController<Schema> {
  const { explore: load, searchText } = options;
  const [result, setResult] = useState(options.initialResult ?? emptyResult);
  const [selectedNodeId, setSelectedNodeId] = useState<string>();
  const [query, setQuery] = useState(options.initialQuery ?? "");
  const [status, setStatus] = useState<GraphExplorerStatus>(
    options.initialResult === undefined ? "idle" : "ready",
  );
  const [error, setError] = useState<unknown>();
  const abortRef = useRef<AbortController | undefined>(undefined);
  const requestIdRef = useRef(0);
  const overviewRef = useRef<GraphExploreOptions<Schema>>({ mode: "overview" });
  const expansionDefaultsRef = useRef<ExpansionDefaults<Schema>>({});

  useEffect(() => () => abortRef.current?.abort(), []);

  const explore = useCallback(
    async (request: GraphExploreOptions<Schema>): Promise<GraphExploreResult | undefined> => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const requestId = ++requestIdRef.current;
      const externalSignal = request.abortSignal;
      const abortFromExternal = () => {
        controller.abort();
        if (requestId === requestIdRef.current) {
          abortRef.current = undefined;
          setStatus("ready");
        }
      };
      if (externalSignal?.aborted === true) {
        abortFromExternal();
        setError(undefined);
        return undefined;
      }
      externalSignal?.addEventListener("abort", abortFromExternal, { once: true });

      const nextRequest = {
        ...request,
        abortSignal: controller.signal,
      } as GraphExploreOptions<Schema>;
      if (request.mode === "overview") overviewRef.current = withoutAbortSignal(request);
      setStatus("loading");
      setError(undefined);

      try {
        const next = await load(nextRequest);
        if (controller.signal.aborted || requestId !== requestIdRef.current) return undefined;
        setResult((current) =>
          request.mode === "expand" ? mergeGraphExploreResults(current, next) : next,
        );
        if (request.mode === "overview") {
          expansionDefaultsRef.current = expansionDefaults(request);
          setSelectedNodeId((current) =>
            next.nodes.some((node) => node.id === current) ? current : undefined,
          );
        }
        setStatus("ready");
        return next;
      } catch (caught) {
        if (controller.signal.aborted || requestId !== requestIdRef.current) return undefined;
        setError(caught);
        setStatus("error");
        throw caught;
      } finally {
        externalSignal?.removeEventListener("abort", abortFromExternal);
        if (abortRef.current === controller) abortRef.current = undefined;
      }
    },
    [load],
  );

  const expandNode = useCallback(
    (nodeId: string, expandOptions: GraphExplorerExpandNodeOptions<Schema> = {}) => {
      if (nodeId.length === 0) throw new TypeError("Graph explorer node id must be non-empty.");
      return explore({
        ...expansionDefaultsRef.current,
        ...expandOptions,
        mode: "expand",
        nodeIds: [nodeId],
      });
    },
    [explore],
  );
  const refresh = useCallback(() => explore(overviewRef.current), [explore]);
  const stop = useCallback(() => {
    requestIdRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = undefined;
    setError(undefined);
    setStatus("ready");
  }, []);
  const reset = useCallback(() => {
    requestIdRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = undefined;
    overviewRef.current = { mode: "overview" };
    expansionDefaultsRef.current = {};
    setResult(emptyResult);
    setSelectedNodeId(undefined);
    setQuery("");
    setError(undefined);
    setStatus("idle");
  }, []);
  const nodeById = useMemo(
    () => new Map(result.nodes.map((node) => [node.id, node])),
    [result.nodes],
  );
  const selectedNode = selectedNodeId === undefined ? undefined : nodeById.get(selectedNodeId);
  const matchedNodeIds = useMemo(
    () =>
      new Set(
        result.nodes
          .filter((node) => graphExplorerNodeMatches(node, query, searchText))
          .map((node) => node.id),
      ),
    [query, result.nodes, searchText],
  );

  return useMemo(
    () => ({
      nodes: result.nodes,
      nodeById,
      relationships: result.relationships,
      truncated: result.truncated,
      selectedNodeId,
      selectedNode,
      query,
      matchedNodeIds,
      status,
      error,
      explore,
      expandNode,
      refresh,
      selectNode: setSelectedNodeId,
      setQuery,
      stop,
      reset,
    }),
    [
      error,
      expandNode,
      explore,
      matchedNodeIds,
      nodeById,
      query,
      refresh,
      reset,
      result,
      selectedNode,
      selectedNodeId,
      status,
      stop,
    ],
  );
}

export function mergeGraphExploreResults(
  current: GraphExploreResult,
  next: GraphExploreResult,
): GraphExploreResult {
  const nodes = new Map(current.nodes.map((node) => [node.id, node]));
  const relationships = new Map(
    current.relationships.map((relationship) => [relationship.id, relationship]),
  );
  for (const node of next.nodes) nodes.set(node.id, node);
  for (const relationship of next.relationships) relationships.set(relationship.id, relationship);
  return {
    nodes: [...nodes.values()],
    relationships: [...relationships.values()],
    truncated: {
      nodes: current.truncated.nodes || next.truncated.nodes,
      relationships: current.truncated.relationships || next.truncated.relationships,
    },
  };
}

export function graphExplorerNodeMatches(
  node: GraphExploreNode,
  query: string,
  searchText?: ((node: GraphExploreNode) => string) | undefined,
): boolean {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (normalizedQuery.length === 0) return true;
  if (searchText !== undefined) {
    return searchText(node).toLocaleLowerCase().includes(normalizedQuery);
  }
  return defaultGraphExplorerNodeSearchValues(node).some((value) =>
    String(value ?? "")
      .toLocaleLowerCase()
      .includes(normalizedQuery),
  );
}

function defaultGraphExplorerNodeSearchValues(node: GraphExploreNode): unknown[] {
  const properties = Object.entries(node.properties).flatMap(([key, value]) => [
    key,
    Array.isArray(value) ? value.join(" ") : String(value),
  ]);
  return [node.type, node.key, ...Object.values(node.identity), ...properties];
}

function withoutAbortSignal<Schema extends GraphSchemaLike>(
  options: GraphExploreOptions<Schema>,
): GraphExploreOptions<Schema> {
  const { abortSignal: _abortSignal, ...request } = options;
  return request as GraphExploreOptions<Schema>;
}

function expansionDefaults<Schema extends GraphSchemaLike>(
  options: Extract<GraphExploreOptions<Schema>, { mode: "overview" }>,
): ExpansionDefaults<Schema> {
  return {
    nodeTypes: options.nodeTypes,
    relationships: options.relationships,
    includeProvenance: options.includeProvenance,
    maxNodes: options.maxNodes,
    maxRelationships: options.maxRelationships,
  };
}
