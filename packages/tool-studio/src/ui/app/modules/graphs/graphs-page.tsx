import { Background, BackgroundVariant, Controls, ReactFlow } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ArrowClockwise, MagnifyingGlass, Plus } from "@phosphor-icons/react";
import type {
  GraphExploreNode,
  GraphExploreOptions,
  GraphExploreResult,
  GraphSchemaLike,
} from "@anvia/graph";
import { useGraphExplorer } from "@anvia/react/graph-explorer";
import { graphExplorerNodeLabel, GraphExplorerProvider } from "@anvia/react-ui/graph-explorer";
import { type CSSProperties, useCallback, useEffect, useMemo, useState } from "react";
import type { StudioConfig } from "../../../../types";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import {
  StudioEmptyState,
  StudioPageShell,
  StudioStatusBadge,
  StudioSurface,
} from "../../components/ui/studio";
import { errorMessage } from "../shared/format";
import { JsonSyntax } from "../shared/renderers";
import { requestJson } from "../shared/request";
import { explorerNodeTypes, toExplorerFlow } from "./graph-flow";

export function GraphsPage(props: {
  graphs: StudioConfig["graphs"];
  enabled: boolean;
  theme: "light" | "dark";
  onError: (message: string) => void;
  onStatus: (message: string) => void;
}) {
  const { onError, onStatus } = props;
  const [selectedGraphId, setSelectedGraphId] = useState(props.graphs[0]?.id ?? "");
  const [selectedNodeTypes, setSelectedNodeTypes] = useState<string[]>([]);
  const [selectedRelationships, setSelectedRelationships] = useState<string[]>([]);
  const graph = props.graphs.find((item) => item.id === selectedGraphId) ?? props.graphs[0];
  const loadGraph = useCallback(
    async (request: GraphExploreOptions<GraphSchemaLike>) => {
      if (graph === undefined) throw new Error("Graph explorer unavailable");
      const { abortSignal, ...body } = request;
      onStatus("Loading graph");
      try {
        const next = await requestJson<GraphExploreResult>(
          `/graphs/${encodeURIComponent(graph.id)}/explore`,
          "Graph explorer",
          abortSignal,
          "no-store",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          },
        );
        if (abortSignal?.aborted !== true) onStatus("Connected");
        return next;
      } catch (loadError) {
        if (abortSignal?.aborted !== true) {
          onError(errorMessage(loadError));
          onStatus("Graph error");
        }
        throw loadError;
      }
    },
    [graph, onError, onStatus],
  );
  const explorer = useGraphExplorer({ explore: loadGraph });
  const result = useMemo<GraphExploreResult>(
    () => ({
      nodes: explorer.nodes,
      relationships: explorer.relationships,
      truncated: explorer.truncated,
    }),
    [explorer.nodes, explorer.relationships, explorer.truncated],
  );
  const flow = useMemo(
    () => toExplorerFlow(result, explorer.matchedNodeIds),
    [explorer.matchedNodeIds, result],
  );
  const loading = explorer.status === "loading";
  const selectedNode = explorer.selectedNode;
  const explore = explorer.explore;
  const resetExplorer = explorer.reset;
  const selectNode = explorer.selectNode;

  useEffect(() => {
    if (graph === undefined) return;
    const nodeTypes = graph.nodeTypes.map((item) => item.name);
    const relationships = graph.relationshipTypes.map((item) => item.name);
    setSelectedGraphId(graph.id);
    setSelectedNodeTypes(nodeTypes);
    setSelectedRelationships(relationships);
    resetExplorer();
    void explore({ mode: "overview", nodeTypes, relationships })
      .then((next) => {
        if (next !== undefined) selectNode(next.nodes[0]?.id);
      })
      .catch(() => undefined);
  }, [explore, graph, resetExplorer, selectNode]);

  if (!props.enabled || props.graphs.length === 0) {
    return (
      <StudioPageShell aria-label="Graphs">
        <StudioEmptyState
          title={props.enabled ? "No graphs" : "Graph explorer unavailable"}
          text={
            props.enabled
              ? "Register a graph in Studio to inspect its nodes and relationships."
              : "This Studio runtime does not expose a graph explorer."
          }
        />
      </StudioPageShell>
    );
  }

  function reloadOverview() {
    void explore({
      mode: "overview",
      nodeTypes: selectedNodeTypes,
      relationships: selectedRelationships,
    })
      .then((next) => {
        if (next !== undefined) selectNode(next.nodes[0]?.id);
      })
      .catch(() => undefined);
  }

  function expandSelected() {
    if (selectedNode === undefined) return;
    void explorer
      .expandNode(selectedNode.id, {
        nodeTypes: selectedNodeTypes,
        relationships: selectedRelationships,
        direction: "both",
        maxDepth: 1,
      })
      .catch(() => undefined);
  }

  return (
    <GraphExplorerProvider controller={explorer}>
      <StudioPageShell aria-label="Graphs">
        <div className="grid min-h-0 min-w-0 pb-6 pr-6">
          <StudioSurface className="grid grid-cols-[minmax(0,2fr)_340px] max-lg:grid-cols-1">
            <div className="relative min-h-0 min-w-0 overflow-hidden border-r border-border/80 bg-card/25 max-lg:min-h-96 max-lg:border-b max-lg:border-r-0">
              <div className="absolute left-4 top-4 z-10 flex max-w-[calc(100%-2rem)] items-center gap-2 rounded-xl border border-border/80 bg-background/90 p-2 shadow-sm backdrop-blur">
                <div className="relative min-w-0 flex-1">
                  <MagnifyingGlass className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    aria-label="Search loaded nodes"
                    className="w-64 pl-8"
                    placeholder="Search loaded nodes"
                    value={explorer.query}
                    onChange={(event) => explorer.setQuery(event.currentTarget.value)}
                  />
                </div>
                <StudioStatusBadge>{flow.nodes.length} nodes</StudioStatusBadge>
                <StudioStatusBadge>{flow.edges.length} relations</StudioStatusBadge>
              </div>
              {loading && result.nodes.length === 0 ? (
                <div className="grid h-full min-h-96 place-items-center text-sm text-muted-foreground">
                  Loading graph…
                </div>
              ) : null}
              {!loading && result.nodes.length === 0 ? (
                <StudioEmptyState
                  className="h-full border-0"
                  title="No nodes found"
                  text="Try another graph or broaden the selected node and relationship types."
                />
              ) : null}
              {result.nodes.length > 0 ? (
                <ReactFlow
                  key={`${graph?.id}:${result.nodes.length}:${result.relationships.length}`}
                  nodes={flow.nodes}
                  edges={flow.edges}
                  className="graph-explorer-flow"
                  colorMode={props.theme}
                  nodeTypes={explorerNodeTypes}
                  fitView
                  fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
                  minZoom={0.2}
                  maxZoom={1.7}
                  proOptions={{ hideAttribution: true }}
                  defaultEdgeOptions={{ focusable: true }}
                  style={
                    {
                      "--xy-edge-stroke": "var(--muted-foreground)",
                      "--xy-edge-stroke-width": "1.4",
                      "--xy-edge-stroke-selected": "var(--foreground)",
                    } as CSSProperties
                  }
                  onNodeClick={(_, node) => explorer.selectNode(node.id)}
                >
                  <Background
                    variant={BackgroundVariant.Dots}
                    gap={16}
                    size={1.5}
                    color="var(--muted-foreground)"
                    className="opacity-30"
                  />
                  <Controls showInteractive={false} />
                </ReactFlow>
              ) : null}
            </div>
            <GraphInspector
              graph={graph}
              graphs={props.graphs}
              loading={loading}
              result={result}
              selectedGraphId={selectedGraphId}
              selectedNode={selectedNode}
              selectedNodeTypes={selectedNodeTypes}
              selectedRelationships={selectedRelationships}
              onExpand={expandSelected}
              onReload={reloadOverview}
              onSelectGraph={setSelectedGraphId}
              onToggleNodeType={(type) => setSelectedNodeTypes((types) => toggled(types, type))}
              onToggleRelationship={(type) =>
                setSelectedRelationships((types) => toggled(types, type))
              }
            />
          </StudioSurface>
        </div>
      </StudioPageShell>
    </GraphExplorerProvider>
  );
}

function GraphInspector(props: {
  graph: StudioConfig["graphs"][number] | undefined;
  graphs: StudioConfig["graphs"];
  loading: boolean;
  result: GraphExploreResult;
  selectedGraphId: string;
  selectedNode: GraphExploreNode | undefined;
  selectedNodeTypes: string[];
  selectedRelationships: string[];
  onExpand: () => void;
  onReload: () => void;
  onSelectGraph: (id: string) => void;
  onToggleNodeType: (type: string) => void;
  onToggleRelationship: (type: string) => void;
}) {
  const truncated = props.result.truncated.nodes || props.result.truncated.relationships;
  return (
    <aside className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-background/70">
      <header className="grid gap-3 border-b border-border/80 bg-card/35 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold">
              {props.graph?.name ?? "Graph explorer"}
            </h1>
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
              {props.graph?.description ?? "Explore a bounded view of nodes and relationships."}
            </p>
          </div>
          {truncated ? (
            <StudioStatusBadge title="The configured result limit was reached">
              Limited
            </StudioStatusBadge>
          ) : null}
        </div>
        <Select value={props.selectedGraphId} onValueChange={props.onSelectGraph}>
          <SelectTrigger className="h-8 w-full text-xs">
            <SelectValue placeholder="Select graph" />
          </SelectTrigger>
          <SelectContent>
            {props.graphs.map((graph) => (
              <SelectItem key={graph.id} value={graph.id}>
                {graph.name ?? graph.id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex gap-2">
          <Button
            className="flex-1"
            variant="secondary"
            disabled={props.loading || props.selectedNodeTypes.length === 0}
            onClick={props.onReload}
          >
            <ArrowClockwise /> Refresh
          </Button>
          <Button
            className="flex-1"
            disabled={props.loading || props.selectedNode === undefined}
            onClick={props.onExpand}
          >
            <Plus /> Expand
          </Button>
        </div>
      </header>
      <div className="min-h-0 overflow-y-auto p-4">
        <FilterGroup
          label="Node types"
          items={props.graph?.nodeTypes.map((item) => item.name) ?? []}
          selected={props.selectedNodeTypes}
          onToggle={props.onToggleNodeType}
        />
        <FilterGroup
          label="Relationships"
          items={props.graph?.relationshipTypes.map((item) => item.name) ?? []}
          selected={props.selectedRelationships}
          onToggle={props.onToggleRelationship}
        />
        <div className="mt-5 border-t border-border/80 pt-4">
          {props.selectedNode === undefined ? (
            <p className="text-sm text-muted-foreground">
              Select a node to inspect its properties.
            </p>
          ) : (
            <NodeInspector node={props.selectedNode} />
          )}
        </div>
      </div>
    </aside>
  );
}

function FilterGroup(props: {
  label: string;
  items: string[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <section className="mb-4">
      <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {props.label}
      </h2>
      <div className="flex flex-wrap gap-1.5">
        {props.items.map((item) => {
          const active = props.selected.includes(item);
          return (
            <button
              key={item}
              type="button"
              aria-pressed={active}
              className={[
                "rounded-full border px-2 py-1 text-xs transition-colors",
                active
                  ? "border-foreground/30 bg-foreground text-background"
                  : "border-border bg-card text-muted-foreground hover:text-foreground",
              ].join(" ")}
              onClick={() => props.onToggle(item)}
            >
              {item}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function NodeInspector(props: { node: GraphExploreNode }) {
  const json = JSON.stringify(
    { identity: props.node.identity, properties: props.node.properties },
    null,
    2,
  );
  return (
    <section>
      <StudioStatusBadge>{props.node.type}</StudioStatusBadge>
      <h2 className="mt-2 break-words text-base font-semibold">
        {graphExplorerNodeLabel(props.node)}
      </h2>
      <p className="mt-1 break-all text-xs text-muted-foreground">ID {props.node.id}</p>
      <pre className="mt-4 overflow-x-auto rounded-xl border border-border/80 bg-card p-3 text-xs leading-5">
        <code>
          <JsonSyntax text={json} />
        </code>
      </pre>
    </section>
  );
}

function toggled(values: string[], value: string): string[] {
  if (values.includes(value)) return values.filter((item) => item !== value);
  return [...values, value];
}
