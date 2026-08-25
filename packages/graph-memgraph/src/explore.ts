import {
  resolveGraphExploreOptions,
  type GraphExploreNode,
  type GraphExploreOptions,
  type GraphExploreRelationship,
  type GraphExploreResult,
  type GraphProperties,
  type GraphSchemaLike,
  type ResolvedGraphExploreExpandOptions,
} from "@anvia/graph";
import { int, isInt, type Record as DriverRecord } from "neo4j-driver";
import { MemgraphKnowledgeGraphBase } from "./graph.js";
import { quoteIdentifier, strictProperties } from "./helpers.js";

export async function exploreGraph<Schema extends GraphSchemaLike>(
  graph: MemgraphKnowledgeGraphBase<Schema>,
  options: GraphExploreOptions<Schema>,
): Promise<GraphExploreResult> {
  if (!(graph instanceof MemgraphKnowledgeGraphBase)) {
    throw new TypeError("exploreGraph requires a Memgraph knowledge graph registration.");
  }
  const resolved = resolveGraphExploreOptions(graph.schema, options);
  const records =
    resolved.mode === "overview"
      ? await overviewNodes(graph, resolved)
      : await expandedNodes(graph, resolved);
  const nodes = uniqueNodes(records.map((record) => nodeFromRecord(record, graph.schema)));
  const visibleNodes = nodes.slice(0, resolved.maxNodes);
  const relationships = await relationshipsBetween(
    graph,
    visibleNodes.map((node) => node.id),
    resolved.relationships,
    resolved.maxRelationships,
    resolved.abortSignal,
  );
  return {
    nodes: visibleNodes,
    relationships: relationships.slice(0, resolved.maxRelationships),
    truncated: {
      nodes: records.length > resolved.maxNodes || nodes.length > resolved.maxNodes,
      relationships: relationships.length > resolved.maxRelationships,
    },
  };
}

async function overviewNodes(
  graph: MemgraphKnowledgeGraphBase,
  options: ReturnType<typeof resolveGraphExploreOptions> & { mode: "overview" },
): Promise<readonly DriverRecord[]> {
  const result = await graph.query(
    `MATCH (node)
WHERE any(type IN labels(node) WHERE type IN $nodeTypes)
RETURN id(node) AS id, labels(node) AS labels, properties(node) AS properties
ORDER BY id(node)
LIMIT $nodeLimit`,
    { nodeTypes: options.nodeTypes, nodeLimit: int(options.maxNodes + 1) },
    options.abortSignal,
  );
  return result.records;
}

async function expandedNodes(
  graph: MemgraphKnowledgeGraphBase,
  options: ResolvedGraphExploreExpandOptions,
): Promise<readonly DriverRecord[]> {
  const nodeIds = options.nodeIds.map(nodeIdParameter);
  const roots = await graph.query(
    `MATCH (node)
WHERE id(node) IN $nodeIds
  AND any(type IN labels(node) WHERE type IN $nodeTypes)
RETURN id(node) AS id, labels(node) AS labels, properties(node) AS properties`,
    { nodeIds, nodeTypes: options.nodeTypes },
    options.abortSignal,
  );
  if (options.relationships.length === 0) return roots.records;
  const remainingNodeLimit = options.maxNodes + 1 - roots.records.length;
  if (remainingNodeLimit <= 0) return roots.records;
  const relationshipTypes = options.relationships.map(quoteIdentifier).join("|");
  const pattern = traversalPattern(relationshipTypes, options.direction, options.maxDepth);
  const neighbors = await graph.query(
    `MATCH (root) WHERE id(root) IN $nodeIds
MATCH path = ${pattern}
WHERE any(type IN labels(node) WHERE type IN $nodeTypes)
RETURN id(node) AS id, labels(node) AS labels, properties(node) AS properties
LIMIT $nodeLimit`,
    {
      nodeIds,
      nodeTypes: options.nodeTypes,
      nodeLimit: int(remainingNodeLimit),
    },
    options.abortSignal,
  );
  return [...roots.records, ...neighbors.records];
}

async function relationshipsBetween(
  graph: MemgraphKnowledgeGraphBase,
  nodeIds: readonly string[],
  relationshipTypes: readonly string[],
  maxRelationships: number,
  abortSignal?: AbortSignal,
): Promise<GraphExploreRelationship[]> {
  if (nodeIds.length === 0 || relationshipTypes.length === 0) return [];
  const result = await graph.query(
    `MATCH (from)-[relationship]->(to)
WHERE id(from) IN $nodeIds
  AND id(to) IN $nodeIds
  AND type(relationship) IN $relationshipTypes
RETURN id(relationship) AS id,
       type(relationship) AS type,
       id(from) AS source,
       id(to) AS target,
       properties(relationship) AS properties
ORDER BY id(relationship)
LIMIT $relationshipLimit`,
    {
      nodeIds: nodeIds.map(nodeIdParameter),
      relationshipTypes,
      relationshipLimit: int(maxRelationships + 1),
    },
    abortSignal,
  );
  return result.records.map(relationshipFromRecord);
}

function nodeFromRecord(record: DriverRecord, schema: GraphSchemaLike): GraphExploreNode {
  const id = driverId(record.get("id"), "Memgraph explorer node id");
  const labels = stringArray(record.get("labels"), "Memgraph explorer node labels");
  const raw = objectValue(record.get("properties"), "Memgraph explorer node properties");
  const type = labels.find((label) => label in schema.nodes);
  if (type === undefined) throw new TypeError("Memgraph explorer node has no registered type.");
  const properties = applicationProperties(raw, "Memgraph explorer node properties");
  const node: {
    id: string;
    key?: string | undefined;
    type: string;
    identity: Record<string, string | number | boolean>;
    properties: GraphProperties;
  } = {
    id,
    type,
    identity: identityProperties(schema, type, properties),
    properties,
  };
  const key = raw.__anvia_key;
  if (typeof key === "string") node.key = key;
  return node;
}

function relationshipFromRecord(record: DriverRecord): GraphExploreRelationship {
  const raw = objectValue(record.get("properties"), "Memgraph explorer relationship properties");
  const relationship: {
    id: string;
    key?: string | undefined;
    type: string;
    from: string;
    to: string;
    properties: GraphProperties;
  } = {
    id: driverId(record.get("id"), "Memgraph explorer relationship id"),
    type: stringValue(record.get("type"), "Memgraph explorer relationship type"),
    from: driverId(record.get("source"), "Memgraph explorer relationship source"),
    to: driverId(record.get("target"), "Memgraph explorer relationship target"),
    properties: applicationProperties(raw, "Memgraph explorer relationship properties"),
  };
  const key = raw.__anvia_key;
  if (typeof key === "string") relationship.key = key;
  return relationship;
}

function identityProperties(
  schema: GraphSchemaLike,
  type: string,
  properties: GraphProperties,
): Record<string, string | number | boolean> {
  const identity: Record<string, string | number | boolean> = {};
  const definition = schema.nodes[type];
  if (definition === undefined) return identity;
  for (const property of definition.identity) {
    const value = properties[property];
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      identity[property] = value;
    }
  }
  return identity;
}

function applicationProperties(value: Record<string, unknown>, label: string): GraphProperties {
  return strictProperties(
    Object.fromEntries(Object.entries(value).filter(([key]) => !key.startsWith("__anvia_"))),
    label,
  );
}

function uniqueNodes(nodes: readonly GraphExploreNode[]): GraphExploreNode[] {
  return [...new Map(nodes.map((node) => [node.id, node])).values()];
}

function traversalPattern(
  relationshipTypes: string,
  direction: "outgoing" | "incoming" | "both",
  maxDepth: number,
): string {
  if (direction === "outgoing") {
    return `(root)-[:${relationshipTypes} *BFS 1..${maxDepth}]->(node)`;
  }
  if (direction === "incoming") {
    return `(root)<-[:${relationshipTypes} *BFS 1..${maxDepth}]-(node)`;
  }
  return `(root)-[:${relationshipTypes} *BFS 1..${maxDepth}]-(node)`;
}

function nodeIdParameter(value: string) {
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new TypeError(`Memgraph explorer node id ${value} is invalid.`);
  }
  try {
    return int(value);
  } catch {
    throw new TypeError(`Memgraph explorer node id ${value} is outside the 64-bit integer range.`);
  }
}

function driverId(value: unknown, label: string): string {
  if (isInt(value)) return value.toString();
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  throw new TypeError(`${label} must be a non-negative integer.`);
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string") throw new TypeError(`${label} must be a string.`);
  return value;
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new TypeError(`${label} must be a string array.`);
  }
  return value;
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}
