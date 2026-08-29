import {
  resolveGraphExploreOptions,
  type GraphExploreNode,
  type GraphExploreOptions,
  type GraphExploreRelationship,
  type GraphExploreResult,
  type ResolvedGraphExploreExpandOptions,
} from "@anvia/graph";
import { int, type Record as Neo4jRecord } from "neo4j-driver";
import { ManagedNeo4jKnowledgeGraph, Neo4jKnowledgeGraphBase } from "./graph.js";
import { quoteIdentifier } from "./helpers.js";
import {
  managedPathPredicate,
  managedScopeParameters,
  managedScopePredicate,
  type Neo4jManagedScope,
} from "./managed-scope.js";
import { parseNeo4jProperties } from "./schema.js";
import type { Neo4jGraphSchema, Neo4jNodeIdentity } from "./types.js";

export async function exploreGraph<Schema extends Neo4jGraphSchema>(
  graph: Neo4jKnowledgeGraphBase<Schema>,
  options: GraphExploreOptions<Schema>,
): Promise<GraphExploreResult> {
  if (!(graph instanceof Neo4jKnowledgeGraphBase)) {
    throw new TypeError("exploreGraph requires a Neo4j knowledge graph registration.");
  }
  const resolved = resolveGraphExploreOptions(graph.schema, options);
  const records =
    resolved.mode === "overview"
      ? await overviewNodes(graph, resolved)
      : await expandedNodes(graph, resolved);
  const nodes = uniqueNodes(
    records.map((record) => nodeFromRecord(record, graph.schema, resolved.includeProvenance)),
  );
  const visibleNodes = nodes.slice(0, resolved.maxNodes);
  const relationships = await relationshipsBetween(
    graph,
    visibleNodes.map((node) => node.id),
    resolved.relationships,
    resolved.maxRelationships,
    resolved.includeProvenance,
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
  graph: Neo4jKnowledgeGraphBase,
  options: ReturnType<typeof resolveGraphExploreOptions> & { mode: "overview" },
): Promise<readonly Neo4jRecord[]> {
  const result = await graph.query(
    `MATCH (node${managedEntityLabel(graph)})
WHERE any(type IN labels(node) WHERE type IN $nodeTypes)${managedAndPredicate(graph, "node")}
RETURN elementId(node) AS id, labels(node) AS labels, properties(node) AS properties
ORDER BY elementId(node)
LIMIT $nodeLimit`,
    managedParameters(graph, {
      nodeTypes: options.nodeTypes,
      nodeLimit: int(options.maxNodes + 1),
    }),
    options.abortSignal,
  );
  return result.records;
}

async function expandedNodes(
  graph: Neo4jKnowledgeGraphBase,
  options: ResolvedGraphExploreExpandOptions,
): Promise<readonly Neo4jRecord[]> {
  const roots = await graph.query(
    `MATCH (node${managedEntityLabel(graph)})
WHERE elementId(node) IN $nodeIds
  AND any(type IN labels(node) WHERE type IN $nodeTypes)${managedAndPredicate(graph, "node")}
RETURN elementId(node) AS id, labels(node) AS labels, properties(node) AS properties`,
    managedParameters(graph, { nodeIds: options.nodeIds, nodeTypes: options.nodeTypes }),
    options.abortSignal,
  );
  if (options.relationships.length === 0) return roots.records;
  const remainingNodeLimit = options.maxNodes + 1 - roots.records.length;
  if (remainingNodeLimit <= 0) return roots.records;
  const pattern = traversalPattern(options.direction, options.maxDepth);
  const neighbors = await graph.query(
    `MATCH (root${managedEntityLabel(graph)}) WHERE elementId(root) IN $nodeIds${managedAndPredicate(graph, "root")}
MATCH path = ${pattern}
WHERE all(rel IN relationships(path) WHERE type(rel) IN $relationshipTypes)
  AND any(type IN labels(node) WHERE type IN $nodeTypes)${managedAndPredicate(graph, "node")}${managedPathAndPredicate(graph)}
RETURN elementId(node) AS id, labels(node) AS labels, properties(node) AS properties
LIMIT $nodeLimit`,
    managedParameters(graph, {
      nodeIds: options.nodeIds,
      nodeTypes: options.nodeTypes,
      relationshipTypes: options.relationships,
      nodeLimit: int(remainingNodeLimit),
    }),
    options.abortSignal,
  );
  return [...roots.records, ...neighbors.records];
}

async function relationshipsBetween(
  graph: Neo4jKnowledgeGraphBase,
  nodeIds: readonly string[],
  relationshipTypes: readonly string[],
  maxRelationships: number,
  includeProvenance: boolean,
  abortSignal?: AbortSignal,
): Promise<GraphExploreRelationship[]> {
  if (nodeIds.length === 0 || relationshipTypes.length === 0) return [];
  const result = await graph.query(
    `MATCH (from)-[relationship]->(to)
WHERE elementId(from) IN $nodeIds
  AND elementId(to) IN $nodeIds
  AND type(relationship) IN $relationshipTypes${managedAndPredicate(graph, "from")}${managedAndPredicate(graph, "to")}${managedAndPredicate(graph, "relationship")}
RETURN elementId(relationship) AS id,
       type(relationship) AS type,
       elementId(from) AS source,
       elementId(to) AS target,
       properties(relationship) AS properties
ORDER BY elementId(relationship)
LIMIT $relationshipLimit`,
    managedParameters(graph, {
      nodeIds,
      relationshipTypes,
      relationshipLimit: int(maxRelationships + 1),
    }),
    abortSignal,
  );
  return result.records.map((record) => relationshipFromRecord(record, includeProvenance));
}

function nodeFromRecord(
  record: Neo4jRecord,
  schema: Neo4jGraphSchema,
  includeProvenance: boolean,
): GraphExploreNode {
  const id = stringValue(record.get("id"), "Neo4j explorer node id");
  const labels = stringArray(record.get("labels"), "Neo4j explorer node labels");
  const raw = objectValue(record.get("properties"), "Neo4j explorer node properties");
  const type = labels.find((label) => label in schema.nodes);
  if (type === undefined) throw new TypeError("Neo4j explorer node has no registered type.");
  const properties = applicationProperties(raw, "Neo4j explorer node properties");
  const node: {
    id: string;
    key?: string | undefined;
    type: string;
    identity: Neo4jNodeIdentity;
    properties: typeof properties;
    provenance?: { documentIds: string[]; chunkIds: string[] } | undefined;
  } = {
    id,
    type,
    identity: identityProperties(schema, type, properties),
    properties,
  };
  const key = raw.__anvia_key;
  if (typeof key === "string") node.key = key;
  if (includeProvenance) node.provenance = provenanceProperties(raw);
  return node;
}

function relationshipFromRecord(
  record: Neo4jRecord,
  includeProvenance: boolean,
): GraphExploreRelationship {
  const raw = objectValue(record.get("properties"), "Neo4j explorer relationship properties");
  const relationship: {
    id: string;
    key?: string | undefined;
    type: string;
    from: string;
    to: string;
    properties: ReturnType<typeof applicationProperties>;
    provenance?: { documentIds: string[]; chunkIds: string[] } | undefined;
  } = {
    id: stringValue(record.get("id"), "Neo4j explorer relationship id"),
    type: stringValue(record.get("type"), "Neo4j explorer relationship type"),
    from: stringValue(record.get("source"), "Neo4j explorer relationship source"),
    to: stringValue(record.get("target"), "Neo4j explorer relationship target"),
    properties: applicationProperties(raw, "Neo4j explorer relationship properties"),
  };
  const key = raw.__anvia_key;
  if (typeof key === "string") relationship.key = key;
  if (includeProvenance) relationship.provenance = provenanceProperties(raw);
  return relationship;
}

function provenanceProperties(value: Record<string, unknown>) {
  return {
    documentIds: optionalStringArray(value.__anvia_source_document_ids),
    chunkIds: optionalStringArray(value.__anvia_source_chunk_ids),
  };
}

function optionalStringArray(value: unknown): string[] {
  if (value === undefined) return [];
  return stringArray(value, "Neo4j explorer provenance");
}

function identityProperties(
  schema: Neo4jGraphSchema,
  type: string,
  properties: ReturnType<typeof applicationProperties>,
): Neo4jNodeIdentity {
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

function applicationProperties(value: Record<string, unknown>, label: string) {
  return parseNeo4jProperties(
    Object.fromEntries(Object.entries(value).filter(([key]) => !key.startsWith("__anvia_"))),
    label,
  );
}

function uniqueNodes(nodes: readonly GraphExploreNode[]): GraphExploreNode[] {
  return [...new Map(nodes.map((node) => [node.id, node])).values()];
}

function traversalPattern(direction: "outgoing" | "incoming" | "both", maxDepth: number): string {
  if (direction === "outgoing") return `(root)-[*1..${maxDepth}]->(node)`;
  if (direction === "incoming") return `(root)<-[*1..${maxDepth}]-(node)`;
  return `(root)-[*1..${maxDepth}]-(node)`;
}

function managedEntityLabel(graph: Neo4jKnowledgeGraphBase): string {
  return graph instanceof ManagedNeo4jKnowledgeGraph
    ? `:${quoteIdentifier(graph.resources.labels.entity)}`
    : "";
}

function managedParameters(
  graph: Neo4jKnowledgeGraphBase,
  parameters: Record<string, unknown>,
): Record<string, unknown> {
  return managedScopeParameters(managedScope(graph), parameters);
}

function managedAndPredicate(graph: Neo4jKnowledgeGraphBase, variable: string): string {
  return managedScopePredicate(managedScope(graph), variable, " AND");
}

function managedPathAndPredicate(graph: Neo4jKnowledgeGraphBase): string {
  return managedPathPredicate(managedScope(graph), true);
}

function managedScope(graph: Neo4jKnowledgeGraphBase): Neo4jManagedScope | undefined {
  return graph instanceof ManagedNeo4jKnowledgeGraph
    ? { graph: graph.name, namespace: graph.namespace }
    : undefined;
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
