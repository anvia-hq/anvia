import { embedText } from "@anvia/core/embeddings";
import type {
  GraphContext,
  GraphContextNode,
  GraphContextRelationship,
  GraphContextSeed,
  GraphEvidence,
  GraphRetrieveOptions,
  GraphSchemaLike,
} from "@anvia/graph";
import { int, type Record as DriverRecord } from "neo4j-driver";
import { ManagedMemgraphKnowledgeGraph, MemgraphKnowledgeGraphBase } from "./graph.js";
import {
  driverNumber,
  positiveInteger,
  quoteIdentifier,
  strictProperties,
  throwIfAborted,
} from "./helpers.js";
import type { MemgraphSeedRegistration } from "./resources.js";

export type RetrieveMemgraphOptions<Schema extends GraphSchemaLike> =
  GraphRetrieveOptions<Schema> & {
    graph: MemgraphKnowledgeGraphBase<Schema>;
  };

type SearchHit = Readonly<{
  internalId: number;
  labels: readonly string[];
  properties: Record<string, unknown>;
  score: number;
  entryRelationshipType?: string | undefined;
}>;

export async function retrieveGraphContext<Schema extends GraphSchemaLike>(
  options: RetrieveMemgraphOptions<Schema>,
): Promise<GraphContext> {
  if (!(options.graph instanceof MemgraphKnowledgeGraphBase)) {
    throw new TypeError("retrieveGraphContext requires a Memgraph knowledge graph registration.");
  }
  throwIfAborted(options.abortSignal);
  validateSearch(options.search);
  validateTraversal(options.graph.schema, options.traversal);
  validateEvidence(options.graph, options.evidence);
  const selected = options.search.seeds.map((name) => ({ name, seed: options.graph.seed(name) }));
  const dimensions = new Set(selected.map(({ seed }) => seed.vectorIndex.dimensions));
  if (dimensions.size !== 1) {
    throw new TypeError("Selected Memgraph graph seeds must use the same vector dimensions.");
  }
  const expectedDimensions = [...dimensions][0];
  if (expectedDimensions === undefined || options.model.dimensions !== expectedDimensions) {
    throw new TypeError(
      `Embedding model dimensions ${options.model.dimensions} do not match Memgraph graph dimensions ${expectedDimensions}.`,
    );
  }
  if (options.search.type === "hybrid") {
    for (const { name, seed } of selected) {
      if (seed.textIndex === undefined) {
        throw new TypeError(`Memgraph graph seed ${name} does not declare a text index.`);
      }
    }
  }
  const { embedding } = await embedText({
    model: options.model,
    text: options.query,
    retries: options.retries,
    abortSignal: options.abortSignal,
  });
  if (embedding.vector.length !== expectedDimensions) {
    throw new TypeError("Query embedding dimensions do not match the Memgraph graph dimensions.");
  }
  const lists: SearchHit[][] = [];
  for (const { seed } of selected) {
    const limit =
      options.search.type === "hybrid" ? options.search.candidatesPerSeed : options.search.topK;
    lists.push(
      await vectorSearch(options.graph, seed, embedding.vector, limit, options.abortSignal),
    );
    if (options.search.type === "hybrid") {
      lists.push(await textSearch(options.graph, seed, options.query, limit, options.abortSignal));
    }
  }
  const hits =
    options.search.type === "hybrid"
      ? fuseResults(lists, options.search.topK, options.search.rrfK)
      : vectorResults(lists[0] ?? [], options.search.topK, options.search.minScore);
  const seeds = hits.map((hit) => seedFromHit(hit, options.graph.schema));
  const traversed =
    hits.length === 0
      ? { nodes: [], relationships: [] }
      : await traverse(options.graph, hits, options.traversal, options.abortSignal);
  const evidence = await hydrateEvidence(
    options.graph,
    { seeds, ...traversed },
    options.evidence,
    options.abortSignal,
  );
  return { seeds, ...traversed, evidence };
}

async function vectorSearch(
  graph: MemgraphKnowledgeGraphBase,
  seed: MemgraphSeedRegistration,
  vector: readonly number[],
  limit: number,
  abortSignal?: AbortSignal,
): Promise<SearchHit[]> {
  const result = await graph.query(
    `CALL vector_search.search($indexName, $limit, $vector)
YIELD node, similarity
RETURN id(node) AS internalId, labels(node) AS labels, properties(node) AS properties, similarity AS score`,
    { indexName: seed.vectorIndex.name, limit: int(limit), vector },
    abortSignal,
  );
  return result.records.map((record) => ({
    ...parseSearchHit(record),
    entryRelationshipType: seed.entryRelationshipType,
  }));
}

async function textSearch(
  graph: MemgraphKnowledgeGraphBase,
  seed: MemgraphSeedRegistration,
  query: string,
  limit: number,
  abortSignal?: AbortSignal,
): Promise<SearchHit[]> {
  if (seed.textIndex === undefined) throw new TypeError("Hybrid search requires a text index.");
  const result = await graph.query(
    `CALL text_search.search_all($indexName, $query, {limit: $limit})
YIELD node, score
RETURN id(node) AS internalId, labels(node) AS labels, properties(node) AS properties, score`,
    { indexName: seed.textIndex.name, query, limit: int(limit) },
    abortSignal,
  );
  return result.records.map((record) => ({
    ...parseSearchHit(record),
    entryRelationshipType: seed.entryRelationshipType,
  }));
}

function parseSearchHit(record: DriverRecord): SearchHit {
  const labels = record.get("labels");
  const properties = record.get("properties");
  if (
    !Array.isArray(labels) ||
    !labels.every((label) => typeof label === "string") ||
    typeof properties !== "object" ||
    properties === null ||
    Array.isArray(properties)
  ) {
    throw new TypeError("Memgraph search returned a malformed result.");
  }
  return {
    internalId: driverNumber(record.get("internalId"), "Memgraph search internal id"),
    labels,
    properties: properties as Record<string, unknown>,
    score: driverNumber(record.get("score"), "Memgraph search score"),
  };
}

function seedFromHit(hit: SearchHit, schema: GraphSchemaLike): GraphContextSeed {
  const key =
    stringProperty(hit.properties, "__anvia_key") ??
    stringProperty(hit.properties, "__anvia_id") ??
    String(hit.internalId);
  return {
    key,
    type: hit.labels.find((label) => label in schema.nodes) ?? hit.labels[0] ?? "Node",
    score: hit.score,
    properties: applicationProperties(hit.properties, "Memgraph search seed"),
    sourceChunkIds:
      hit.entryRelationshipType === "ANVIA_MENTIONS"
        ? [key]
        : stringArrayProperty(hit.properties, "__anvia_source_chunk_ids"),
  };
}

async function traverse<Schema extends GraphSchemaLike>(
  graph: MemgraphKnowledgeGraphBase<Schema>,
  hits: readonly SearchHit[],
  options: GraphRetrieveOptions<Schema>["traversal"],
  abortSignal?: AbortSignal,
): Promise<{ nodes: GraphContextNode[]; relationships: GraphContextRelationship[] }> {
  const direct = hits
    .filter((hit) => hit.entryRelationshipType === undefined)
    .map((hit) => hit.internalId);
  const entry = hits.filter(
    (hit): hit is SearchHit & { entryRelationshipType: string } =>
      hit.entryRelationshipType !== undefined,
  );
  const traversalIds = new Set(direct);
  for (const [relationshipType, group] of groupBy(entry, (hit) => hit.entryRelationshipType)) {
    const result = await graph.query(
      `MATCH (seed) WHERE id(seed) IN $ids
MATCH (seed)-[:${quoteIdentifier(relationshipType)}]->(entry)
RETURN DISTINCT id(entry) AS internalId`,
      { ids: group.map((hit) => int(hit.internalId)) },
      abortSignal,
    );
    for (const record of result.records) {
      traversalIds.add(driverNumber(record.get("internalId"), "Memgraph traversal entry id"));
    }
  }
  if (traversalIds.size === 0) return { nodes: [], relationships: [] };
  const seedIds = [...traversalIds].slice(0, options.maxNodes);
  const types = options.relationships.map(quoteIdentifier).join("|");
  const pattern =
    options.direction === "outgoing"
      ? `(seed)-[:${types} *BFS 1..${options.maxDepth}]->(node)`
      : options.direction === "incoming"
        ? `(seed)<-[:${types} *BFS 1..${options.maxDepth}]-(node)`
        : `(seed)-[:${types} *BFS 1..${options.maxDepth}]-(node)`;
  const seeds = await graph.query(
    `MATCH (node) WHERE id(node) IN $seedIds
RETURN {internalId: id(node), labels: labels(node), properties: properties(node)} AS node`,
    { seedIds: seedIds.map((id) => int(id)) },
    abortSignal,
  );
  const paths = await graph.query(
    `MATCH (seed) WHERE id(seed) IN $seedIds
MATCH path = ${pattern}
RETURN [item IN nodes(path) | {internalId: id(item), labels: labels(item), properties: properties(item)}] AS nodes,
       [item IN relationships(path) | {internalId: id(item), type: type(item), properties: properties(item), from: id(startNode(item)), to: id(endNode(item))}] AS relationships
LIMIT $pathLimit`,
    {
      seedIds: seedIds.map((id) => int(id)),
      pathLimit: int(Math.max(options.maxNodes, options.maxRelationships)),
    },
    abortSignal,
  );
  const nodes = new Map<string, GraphContextNode>();
  const keys = new Map<number, string>();
  const addNode = (value: Record<string, unknown>) => {
    const parsed = contextNode(value, graph.schema);
    if (!nodes.has(parsed.node.key) && nodes.size >= options.maxNodes) return;
    nodes.set(parsed.node.key, parsed.node);
    keys.set(parsed.internalId, parsed.node.key);
  };
  for (const record of seeds.records) addNode(requiredMap(record.get("node"), "seed node"));
  for (const record of paths.records) {
    for (const value of listOfMaps(record.get("nodes"), "traversal nodes")) addNode(value);
  }
  const relationships = new Map<string, GraphContextRelationship>();
  for (const record of paths.records) {
    for (const value of listOfMaps(record.get("relationships"), "traversal relationships")) {
      const parsed = contextRelationship(value, keys);
      if (parsed !== undefined && relationships.size < options.maxRelationships) {
        relationships.set(parsed.key, parsed);
      }
    }
  }
  return { nodes: [...nodes.values()], relationships: [...relationships.values()] };
}

function contextNode(
  value: Record<string, unknown>,
  schema: GraphSchemaLike,
): { internalId: number; node: GraphContextNode } {
  const labels = value.labels;
  const raw = value.properties;
  if (!Array.isArray(labels) || !labels.every((label) => typeof label === "string")) {
    throw new TypeError("Memgraph traversal returned malformed node labels.");
  }
  const map = requiredMap(raw, "node properties");
  const properties = applicationProperties(map, "Memgraph graph node");
  const type = labels.find((label) => label in schema.nodes) ?? labels[0] ?? "Node";
  const definition = schema.nodes[type];
  const identity: Record<string, string | number | boolean> = {};
  if (definition !== undefined) {
    for (const property of definition.identity) {
      const item = properties[property];
      if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
        identity[property] = item;
      }
    }
  }
  const internalId = driverNumber(value.internalId, "Memgraph node internal id");
  return {
    internalId,
    node: {
      key: stringProperty(map, "__anvia_key") ?? String(internalId),
      type,
      identity,
      properties,
      sourceChunkIds: stringArrayProperty(map, "__anvia_source_chunk_ids"),
    },
  };
}

function contextRelationship(
  value: Record<string, unknown>,
  nodeKeys: ReadonlyMap<number, string>,
): GraphContextRelationship | undefined {
  const raw = requiredMap(value.properties, "relationship properties");
  const internalId = driverNumber(value.internalId, "Memgraph relationship internal id");
  const from = nodeKeys.get(driverNumber(value.from, "Memgraph relationship source"));
  const to = nodeKeys.get(driverNumber(value.to, "Memgraph relationship target"));
  if (from === undefined || to === undefined) return undefined;
  return {
    key: stringProperty(raw, "__anvia_key") ?? String(internalId),
    type: stringValue(value.type, "Memgraph relationship type"),
    from,
    to,
    properties: applicationProperties(raw, "Memgraph graph relationship"),
    sourceChunkIds: stringArrayProperty(raw, "__anvia_source_chunk_ids"),
  };
}

async function hydrateEvidence(
  graph: MemgraphKnowledgeGraphBase,
  context: Pick<GraphContext, "seeds" | "nodes" | "relationships">,
  options: GraphRetrieveOptions<GraphSchemaLike>["evidence"],
  abortSignal?: AbortSignal,
): Promise<GraphEvidence[]> {
  if (options.type === "none") return [];
  if (!(graph instanceof ManagedMemgraphKnowledgeGraph)) {
    throw new TypeError("Chunk evidence requires a managed Memgraph knowledge graph.");
  }
  const chunkIds: string[] = [];
  const seen = new Set<string>();
  for (const ids of [
    ...context.seeds.map((seed) => seed.sourceChunkIds),
    ...context.nodes.map((node) => node.sourceChunkIds),
    ...context.relationships.map((relationship) => relationship.sourceChunkIds),
  ]) {
    for (const id of ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      chunkIds.push(id);
      if (chunkIds.length === options.maxChunks) break;
    }
    if (chunkIds.length === options.maxChunks) break;
  }
  if (chunkIds.length === 0) return [];
  const result = await graph.query(
    `MATCH (d:${quoteIdentifier(graph.resources.labels.document)})-[:${quoteIdentifier("ANVIA_HAS_CHUNK")}]->(c:${quoteIdentifier(graph.resources.labels.chunk)})
WHERE c.${quoteIdentifier("__anvia_id")} IN $chunkIds
RETURN c.${quoteIdentifier("__anvia_id")} AS chunkId,
       d.${quoteIdentifier("__anvia_id")} AS documentId,
       c.${quoteIdentifier("__anvia_index")} AS index,
       c.${quoteIdentifier("__anvia_text")} AS text,
       properties(c) AS properties`,
    { chunkIds },
    abortSignal,
  );
  const byId = new Map(
    result.records.map((record) => {
      const evidence = evidenceFromRecord(record);
      return [evidence.chunkId, evidence];
    }),
  );
  return chunkIds.map((id) => {
    const evidence = byId.get(id);
    if (evidence === undefined)
      throw new Error(`Memgraph evidence references missing chunk ${id}.`);
    return evidence;
  });
}

function evidenceFromRecord(record: DriverRecord): GraphEvidence {
  const properties = requiredMap(record.get("properties"), "evidence properties");
  return {
    chunkId: stringValue(record.get("chunkId"), "Memgraph evidence chunk id"),
    documentId: stringValue(record.get("documentId"), "Memgraph evidence document id"),
    index: driverNumber(record.get("index"), "Memgraph evidence index"),
    text: stringValue(record.get("text"), "Memgraph evidence text"),
    metadata: applicationProperties(properties, "Memgraph evidence metadata"),
  };
}

function validateSearch(search: GraphRetrieveOptions<GraphSchemaLike>["search"]): void {
  positiveInteger(search.topK, "Memgraph graph search topK");
  if (search.seeds.length === 0 || new Set(search.seeds).size !== search.seeds.length) {
    throw new TypeError("Memgraph graph search requires unique seed names.");
  }
  if (search.type === "vector") {
    if (search.seeds.length !== 1) {
      throw new TypeError(
        "Vector graph search accepts exactly one seed; use hybrid search to fuse seeds.",
      );
    }
    if (search.minScore !== undefined && !Number.isFinite(search.minScore)) {
      throw new TypeError("Memgraph graph search minScore must be finite.");
    }
  } else {
    positiveInteger(search.candidatesPerSeed, "Memgraph hybrid candidatesPerSeed");
    positiveInteger(search.rrfK, "Memgraph hybrid rrfK");
  }
}

function validateTraversal(
  schema: GraphSchemaLike,
  traversal: GraphRetrieveOptions<GraphSchemaLike>["traversal"],
): void {
  if (!(["outgoing", "incoming", "both"] as const).includes(traversal.direction)) {
    throw new TypeError("Memgraph traversal direction must be outgoing, incoming, or both.");
  }
  positiveInteger(traversal.maxDepth, "Memgraph traversal maxDepth", 8);
  positiveInteger(traversal.maxNodes, "Memgraph traversal maxNodes");
  positiveInteger(traversal.maxRelationships, "Memgraph traversal maxRelationships");
  if (
    traversal.relationships.length === 0 ||
    new Set(traversal.relationships).size !== traversal.relationships.length
  ) {
    throw new TypeError("Memgraph traversal requires unique relationship types.");
  }
  for (const type of traversal.relationships) {
    if (!(type in schema.relationships)) {
      throw new TypeError(`Memgraph traversal references unknown relationship type ${type}.`);
    }
  }
}

function validateEvidence(
  graph: MemgraphKnowledgeGraphBase,
  evidence: GraphRetrieveOptions<GraphSchemaLike>["evidence"],
): void {
  if (evidence.type === "none") return;
  positiveInteger(evidence.maxChunks, "Memgraph graph evidence maxChunks");
  if (graph.evidenceCapability !== "chunks") {
    throw new TypeError("Chunk evidence requires a managed Memgraph knowledge graph.");
  }
}

function vectorResults(
  results: SearchHit[],
  topK: number,
  minScore: number | undefined,
): SearchHit[] {
  return results.filter((item) => minScore === undefined || item.score >= minScore).slice(0, topK);
}

function fuseResults(lists: readonly SearchHit[][], topK: number, rrfK: number): SearchHit[] {
  const fused = new Map<number, SearchHit>();
  for (const list of lists) {
    list.forEach((item, index) => {
      const current = fused.get(item.internalId);
      fused.set(item.internalId, {
        ...item,
        score: (current?.score ?? 0) + 1 / (rrfK + index + 1),
      });
    });
  }
  return [...fused.values()].sort((left, right) => right.score - left.score).slice(0, topK);
}

function applicationProperties(value: Record<string, unknown>, label: string) {
  return strictProperties(
    Object.fromEntries(Object.entries(value).filter(([key]) => !key.startsWith("__anvia_"))),
    label,
  );
}

function requiredMap(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`Memgraph ${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function listOfMaps(value: unknown, label: string): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new TypeError(`Memgraph ${label} must be an array.`);
  return value.map((item) => requiredMap(item, label));
}

function stringProperty(value: Record<string, unknown>, property: string): string | undefined {
  const item = value[property];
  return item === undefined ? undefined : stringValue(item, `Memgraph property ${property}`);
}

function stringArrayProperty(value: Record<string, unknown>, property: string): string[] {
  const item = value[property];
  if (item === undefined) return [];
  if (!Array.isArray(item) || !item.every((entry) => typeof entry === "string")) {
    throw new TypeError(`Memgraph property ${property} must be a string array.`);
  }
  return [...item];
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string") throw new TypeError(`${label} must be a string.`);
  return value;
}

function groupBy<Value, Key>(
  values: readonly Value[],
  key: (value: Value) => Key,
): Map<Key, Value[]> {
  const groups = new Map<Key, Value[]>();
  for (const value of values) {
    const item = key(value);
    const group = groups.get(item) ?? [];
    group.push(value);
    groups.set(item, group);
  }
  return groups;
}
