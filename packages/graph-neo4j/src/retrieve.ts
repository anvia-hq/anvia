import { embedText } from "@anvia/core/embeddings";
import { int, isInt, type Record as Neo4jRecord } from "neo4j-driver";
import { ManagedNeo4jKnowledgeGraph, Neo4jKnowledgeGraphBase } from "./graph.js";
import {
  finiteScore,
  positiveInteger,
  quoteIdentifier,
  strictProperties,
  throwIfAborted,
} from "./helpers.js";
import type {
  Neo4jGraphContext,
  Neo4jGraphContextNode,
  Neo4jGraphContextRelationship,
  Neo4jGraphContextSeed,
  Neo4jGraphEvidence,
  Neo4jGraphEvidenceOptions,
  Neo4jGraphSchema,
  RetrieveGraphContextOptions,
} from "./types.js";

type SearchHit = {
  elementId: string;
  labels: string[];
  properties: Record<string, unknown>;
  score: number;
  entryRelationshipType?: string | undefined;
};

export async function retrieveGraphContext<Schema extends Neo4jGraphSchema>(
  options: RetrieveGraphContextOptions<Schema>,
): Promise<Neo4jGraphContext> {
  if (!(options.graph instanceof Neo4jKnowledgeGraphBase)) {
    throw new TypeError("retrieveGraphContext requires a Neo4j knowledge graph registration.");
  }
  if (typeof options.query !== "string" || options.query.trim().length === 0) {
    throw new TypeError("Graph retrieval query must be a non-empty string.");
  }
  validateSearch(options.search);
  validateTraversal(options.graph.schema, options.traversal);
  validateEvidence(options.graph.evidenceCapability, options.evidence);
  throwIfAborted(options.abortSignal);
  const graph = options.graph as Neo4jKnowledgeGraphBase<Schema>;
  const selectedSeeds = options.search.seeds.map((name) => ({ name, seed: graph.seed(name) }));
  const expectedDimensions = selectedSeeds[0]?.seed.vectorIndex.dimensions;
  if (
    expectedDimensions === undefined ||
    selectedSeeds.some((item) => item.seed.vectorIndex.dimensions !== expectedDimensions)
  ) {
    throw new TypeError("Selected Neo4j graph seeds must use the same vector dimensions.");
  }
  if (options.model.dimensions !== undefined && options.model.dimensions !== expectedDimensions) {
    throw new TypeError(
      `Embedding model dimensions ${options.model.dimensions} do not match Neo4j graph dimensions ${expectedDimensions}.`,
    );
  }
  if (options.search.type === "hybrid") {
    for (const { name, seed } of selectedSeeds) {
      if (seed.fulltextIndex === undefined) {
        throw new TypeError(`Neo4j graph seed ${name} does not declare a full-text index.`);
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
    throw new TypeError(
      `Query embedding dimensions ${embedding.vector.length} do not match Neo4j graph dimensions ${expectedDimensions}.`,
    );
  }

  const resultLists: SearchHit[][] = [];
  for (const { seed } of selectedSeeds) {
    const limit =
      options.search.type === "hybrid" ? options.search.candidatesPerSeed : options.search.topK;
    resultLists.push(
      await vectorSearch(
        graph,
        seed.labels,
        seed.vectorIndex.name,
        embedding.vector,
        limit,
        seed.entryRelationshipType,
        options.abortSignal,
      ),
    );
    if (options.search.type === "hybrid") {
      const fulltextIndex = seed.fulltextIndex;
      if (fulltextIndex === undefined) {
        throw new TypeError("Hybrid Neo4j graph retrieval requires a full-text index.");
      }
      resultLists.push(
        await fulltextSearch(
          graph,
          fulltextIndex.name,
          options.query,
          limit,
          seed.entryRelationshipType,
          options.abortSignal,
        ),
      );
    }
  }

  const hits =
    options.search.type === "hybrid"
      ? fuseResults(resultLists, options.search.topK, options.search.rrfK)
      : vectorResults(resultLists[0] ?? [], options.search.topK, options.search.minScore);
  throwIfAborted(options.abortSignal);
  const seeds = hits.map((hit) => seedFromHit(hit, options.graph.schema));
  const traversed =
    hits.length === 0
      ? { nodes: [], relationships: [] }
      : await traverse(graph, hits, options.traversal, options.abortSignal);
  const context = { seeds, ...traversed };
  const evidence = await hydrateEvidence(graph, context, options.evidence, options.abortSignal);
  return { ...context, evidence };
}

async function vectorSearch(
  graph: Neo4jKnowledgeGraphBase,
  labels: readonly string[],
  indexName: string,
  vector: readonly number[],
  limit: number,
  entryRelationshipType?: string,
  abortSignal?: AbortSignal,
): Promise<SearchHit[]> {
  const labelExpression = labels.map(quoteIdentifier).join("|");
  const result = await graph.query(
    `CYPHER 25
MATCH (seed:${labelExpression})
SEARCH seed IN (VECTOR INDEX ${quoteIdentifier(indexName)} FOR $vector LIMIT $limit) SCORE AS score
RETURN elementId(seed) AS elementId, labels(seed) AS labels, properties(seed) AS properties, score`,
    { vector, limit: int(limit) },
    abortSignal,
  );
  return result.records.map((record) => ({ ...parseSearchHit(record), entryRelationshipType }));
}

async function fulltextSearch(
  graph: Neo4jKnowledgeGraphBase,
  indexName: string,
  query: string,
  limit: number,
  entryRelationshipType?: string,
  abortSignal?: AbortSignal,
): Promise<SearchHit[]> {
  const result = await graph.query(
    `CALL db.index.fulltext.queryNodes($indexName, $query, {limit: $limit}) YIELD node AS seed, score
RETURN elementId(seed) AS elementId, labels(seed) AS labels, properties(seed) AS properties, score`,
    { indexName, query: escapeLucene(query), limit: int(limit) },
    abortSignal,
  );
  return result.records.map((record) => ({ ...parseSearchHit(record), entryRelationshipType }));
}

function parseSearchHit(record: Neo4jRecord): SearchHit {
  const elementId = record.get("elementId");
  const labels = record.get("labels");
  const properties = record.get("properties");
  const score = record.get("score");
  if (
    typeof elementId !== "string" ||
    !Array.isArray(labels) ||
    !labels.every((label) => typeof label === "string") ||
    typeof properties !== "object" ||
    properties === null ||
    typeof score !== "number" ||
    !Number.isFinite(score)
  ) {
    throw new TypeError("Neo4j search returned a malformed result.");
  }
  return { elementId, labels, properties: properties as Record<string, unknown>, score };
}

function seedFromHit(hit: SearchHit, schema: Neo4jGraphSchema): Neo4jGraphContextSeed {
  const application = applicationProperties(hit.properties, "Neo4j search seed");
  const key =
    stringProperty(hit.properties, "__anvia_key") ??
    stringProperty(hit.properties, "__anvia_id") ??
    hit.elementId;
  const type = hit.labels.find((label) => label in schema.nodes) ?? hit.labels[0] ?? "Node";
  return {
    key,
    type,
    score: hit.score,
    properties: application,
    sourceChunkIds:
      hit.entryRelationshipType === "ANVIA_MENTIONS"
        ? [key]
        : stringArrayProperty(hit.properties, "__anvia_source_chunk_ids"),
  };
}

async function hydrateEvidence(
  graph: Neo4jKnowledgeGraphBase,
  context: Pick<Neo4jGraphContext, "seeds" | "nodes" | "relationships">,
  options: Neo4jGraphEvidenceOptions,
  abortSignal?: AbortSignal,
): Promise<Neo4jGraphEvidence[]> {
  if (options.type === "none") return [];
  if (!(graph instanceof ManagedNeo4jKnowledgeGraph)) {
    throw new TypeError("Chunk evidence requires a managed Neo4j knowledge graph.");
  }
  const chunkIds: string[] = [];
  const seen = new Set<string>();
  for (const sourceChunkIds of [
    ...context.seeds.map((seed) => seed.sourceChunkIds),
    ...context.nodes.map((node) => node.sourceChunkIds),
    ...context.relationships.map((relationship) => relationship.sourceChunkIds),
  ]) {
    for (const chunkId of sourceChunkIds) {
      if (seen.has(chunkId)) continue;
      seen.add(chunkId);
      chunkIds.push(chunkId);
      if (chunkIds.length === options.maxChunks) break;
    }
    if (chunkIds.length === options.maxChunks) break;
  }
  if (chunkIds.length === 0) return [];
  throwIfAborted(abortSignal);
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
  const byId = new Map<string, Neo4jGraphEvidence>();
  for (const record of result.records) {
    const evidence = evidenceFromRecord(record);
    if (byId.has(evidence.chunkId)) {
      throw new TypeError(`Neo4j evidence returned duplicate chunk ${evidence.chunkId}.`);
    }
    byId.set(evidence.chunkId, evidence);
  }
  return chunkIds.map((chunkId) => {
    const evidence = byId.get(chunkId);
    if (evidence === undefined) {
      throw new Error(`Neo4j graph evidence references missing chunk ${chunkId}.`);
    }
    return evidence;
  });
}

function evidenceFromRecord(record: Neo4jRecord): Neo4jGraphEvidence {
  const chunkId = stringValue(record.get("chunkId"), "Neo4j evidence chunk id");
  const documentId = stringValue(record.get("documentId"), "Neo4j evidence document id");
  const index = safeIntegerValue(record.get("index"), "Neo4j evidence chunk index");
  const text = stringValue(record.get("text"), "Neo4j evidence text");
  const raw = record.get("properties");
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new TypeError("Neo4j evidence properties must be an object.");
  }
  return {
    chunkId,
    documentId,
    index,
    text,
    metadata: applicationProperties(raw as Record<string, unknown>, "Neo4j evidence metadata"),
  };
}

function safeIntegerValue(value: unknown, label: string): number {
  let number = value;
  if (isInt(value)) {
    number = undefined;
    if (value.inSafeRange()) {
      number = value.toNumber();
    }
  }
  if (typeof number !== "number" || !Number.isSafeInteger(number)) {
    throw new TypeError(`${label} must be a safe integer.`);
  }
  return number;
}

function vectorResults(
  results: SearchHit[],
  topK: number,
  minScore: number | undefined,
): SearchHit[] {
  return results.filter((item) => minScore === undefined || item.score >= minScore).slice(0, topK);
}

async function traverse<Schema extends Neo4jGraphSchema>(
  graph: Neo4jKnowledgeGraphBase<Schema>,
  seeds: readonly SearchHit[],
  options: RetrieveGraphContextOptions<Schema>["traversal"],
  abortSignal?: AbortSignal,
): Promise<{ nodes: Neo4jGraphContextNode[]; relationships: Neo4jGraphContextRelationship[] }> {
  const traversalSeedIds = new Set(
    seeds.filter((seed) => seed.entryRelationshipType === undefined).map((seed) => seed.elementId),
  );
  const entryGroups = groupBy(
    seeds.filter(
      (seed): seed is SearchHit & { entryRelationshipType: string } =>
        seed.entryRelationshipType !== undefined,
    ),
    (seed) => seed.entryRelationshipType,
  );
  for (const [relationshipType, group] of entryGroups) {
    const entries = await graph.query(
      `MATCH (seed) WHERE elementId(seed) IN $seedIds
MATCH (seed)-[:${quoteIdentifier(relationshipType)}]->(entry)
RETURN DISTINCT elementId(entry) AS elementId`,
      { seedIds: group.map((seed) => seed.elementId) },
      abortSignal,
    );
    for (const record of entries.records) {
      traversalSeedIds.add(stringValue(record.get("elementId"), "Neo4j entry elementId"));
    }
  }
  if (traversalSeedIds.size === 0) return { nodes: [], relationships: [] };
  const limitedSeedIds = [...traversalSeedIds].slice(0, options.maxNodes);
  const pattern = traversalPattern(options.direction, options.maxDepth);
  const pathLimit = Math.max(options.maxNodes, options.maxRelationships);
  const seedNodes = await graph.query(
    `MATCH (node) WHERE elementId(node) IN $seedIds
RETURN {elementId: elementId(node), labels: labels(node), properties: properties(node)} AS node`,
    { seedIds: limitedSeedIds },
    abortSignal,
  );
  const result = await graph.query(
    `MATCH (seed) WHERE elementId(seed) IN $seedIds
MATCH path = ${pattern}
WHERE all(rel IN relationships(path) WHERE type(rel) IN $relationshipTypes)
RETURN [item IN nodes(path) | {elementId: elementId(item), labels: labels(item), properties: properties(item)}] AS nodes,
       [item IN relationships(path) | {elementId: elementId(item), type: type(item), properties: properties(item), from: elementId(startNode(item)), to: elementId(endNode(item))}] AS relationships
LIMIT $pathLimit`,
    {
      seedIds: limitedSeedIds,
      relationshipTypes: options.relationships,
      pathLimit: int(pathLimit),
    },
    abortSignal,
  );
  const nodes = new Map<string, Neo4jGraphContextNode>();
  const nodeKeysByElementId = new Map<string, string>();
  const relationships = new Map<string, Neo4jGraphContextRelationship>();
  const seedNodesByElementId = new Map<string, Record<string, unknown>>();
  for (const record of seedNodes.records) {
    const value = record.get("node");
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new TypeError("Neo4j traversal returned a malformed seed node.");
    }
    const map = value as Record<string, unknown>;
    seedNodesByElementId.set(stringValue(map.elementId, "Neo4j seed node elementId"), map);
  }
  const addNode = (value: Record<string, unknown>) => {
    const parsed = contextNode(value, graph.schema);
    const existing = nodes.get(parsed.node.key);
    if (existing === undefined && nodes.size >= options.maxNodes) return;
    if (existing === undefined) nodes.set(parsed.node.key, parsed.node);
    nodeKeysByElementId.set(parsed.elementId, parsed.node.key);
  };
  for (const elementId of limitedSeedIds) {
    const value = seedNodesByElementId.get(elementId);
    if (value !== undefined) addNode(value);
  }
  for (const record of result.records) {
    for (const value of listOfMaps(record.get("nodes"), "Neo4j traversal nodes")) {
      addNode(value);
    }
  }
  for (const record of result.records) {
    for (const value of listOfMaps(record.get("relationships"), "Neo4j traversal relationships")) {
      const relationship = contextRelationship(value, nodeKeysByElementId);
      if (
        relationship !== undefined &&
        !relationships.has(relationship.key) &&
        relationships.size < options.maxRelationships
      ) {
        relationships.set(relationship.key, relationship);
      }
    }
  }
  return { nodes: [...nodes.values()], relationships: [...relationships.values()] };
}

function traversalPattern(direction: "outgoing" | "incoming" | "both", maxDepth: number): string {
  if (direction === "outgoing") {
    return `(seed)-[*1..${maxDepth}]->(node)`;
  }
  if (direction === "incoming") {
    return `(seed)<-[*1..${maxDepth}]-(node)`;
  }
  return `(seed)-[*1..${maxDepth}]-(node)`;
}

function contextNode(
  value: Record<string, unknown>,
  schema: Neo4jGraphSchema,
): { elementId: string; node: Neo4jGraphContextNode } {
  const labels = value.labels;
  const raw = value.properties;
  if (!Array.isArray(labels) || !labels.every((label) => typeof label === "string")) {
    throw new TypeError("Neo4j traversal returned malformed node labels.");
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new TypeError("Neo4j traversal returned malformed node properties.");
  }
  const properties = applicationProperties(raw as Record<string, unknown>, "Neo4j graph node");
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
  const elementId = stringValue(value.elementId, "Neo4j node elementId");
  return {
    elementId,
    node: {
      key: stringProperty(raw as Record<string, unknown>, "__anvia_key") ?? elementId,
      type,
      identity,
      properties,
      sourceChunkIds: stringArrayProperty(
        raw as Record<string, unknown>,
        "__anvia_source_chunk_ids",
      ),
    },
  };
}

function contextRelationship(
  value: Record<string, unknown>,
  nodeKeysByElementId: ReadonlyMap<string, string>,
): Neo4jGraphContextRelationship | undefined {
  const raw = value.properties;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new TypeError("Neo4j traversal returned malformed relationship properties.");
  }
  const elementId = stringValue(value.elementId, "Neo4j relationship elementId");
  const fromElementId = stringValue(value.from, "Neo4j relationship source");
  const toElementId = stringValue(value.to, "Neo4j relationship target");
  const from = nodeKeysByElementId.get(fromElementId);
  const to = nodeKeysByElementId.get(toElementId);
  if (from === undefined || to === undefined) return undefined;
  return {
    key: stringProperty(raw as Record<string, unknown>, "__anvia_key") ?? elementId,
    type: stringValue(value.type, "Neo4j relationship type"),
    from,
    to,
    properties: applicationProperties(raw as Record<string, unknown>, "Neo4j graph relationship"),
    sourceChunkIds: stringArrayProperty(raw as Record<string, unknown>, "__anvia_source_chunk_ids"),
  };
}

function fuseResults(lists: readonly SearchHit[][], topK: number, rrfK: number): SearchHit[] {
  const fused = new Map<string, SearchHit>();
  for (const list of lists) {
    list.forEach((item, index) => {
      const score = 1 / (rrfK + index + 1);
      const current = fused.get(item.elementId);
      fused.set(item.elementId, { ...item, score: (current?.score ?? 0) + score });
    });
  }
  return [...fused.values()].sort((left, right) => right.score - left.score).slice(0, topK);
}

function validateSearch(search: RetrieveGraphContextOptions<Neo4jGraphSchema>["search"]): void {
  positiveInteger(search.topK, "Neo4j graph search topK");
  if (search.seeds.length === 0 || new Set(search.seeds).size !== search.seeds.length) {
    throw new TypeError("Neo4j graph search requires unique seed names.");
  }
  if (search.type === "vector") {
    if (search.seeds.length !== 1)
      throw new TypeError(
        "Vector graph search accepts exactly one seed; use hybrid search to fuse multiple seeds.",
      );
    finiteScore(search.minScore, "Neo4j graph search minScore");
  } else {
    positiveInteger(search.candidatesPerSeed, "Neo4j hybrid candidatesPerSeed");
    positiveInteger(search.rrfK, "Neo4j hybrid rrfK");
  }
}

function validateEvidence(
  capability: "none" | "chunks",
  evidence: Neo4jGraphEvidenceOptions,
): void {
  if (typeof evidence !== "object" || evidence === null) {
    throw new TypeError("Neo4j graph retrieval requires an explicit evidence mode.");
  }
  if (evidence.type === "none") return;
  if (evidence.type !== "chunks") {
    throw new TypeError("Unknown Neo4j graph evidence mode.");
  }
  positiveInteger(evidence.maxChunks, "Neo4j graph evidence maxChunks");
  if (capability !== "chunks") {
    throw new TypeError("Chunk evidence requires a managed Neo4j knowledge graph.");
  }
}

function validateTraversal(
  schema: Neo4jGraphSchema,
  traversal: RetrieveGraphContextOptions<Neo4jGraphSchema>["traversal"],
): void {
  if (
    traversal.direction !== "outgoing" &&
    traversal.direction !== "incoming" &&
    traversal.direction !== "both"
  ) {
    throw new TypeError("Neo4j traversal direction must be outgoing, incoming, or both.");
  }
  positiveInteger(traversal.maxDepth, "Neo4j traversal maxDepth", 8);
  positiveInteger(traversal.maxNodes, "Neo4j traversal maxNodes");
  positiveInteger(traversal.maxRelationships, "Neo4j traversal maxRelationships");
  if (
    traversal.relationships.length === 0 ||
    new Set(traversal.relationships).size !== traversal.relationships.length
  ) {
    throw new TypeError("Neo4j traversal requires unique relationship types.");
  }
  for (const type of traversal.relationships) {
    if (!(type in schema.relationships))
      throw new TypeError(`Neo4j traversal references unknown relationship type ${type}.`);
  }
}

function applicationProperties(value: Record<string, unknown>, label: string) {
  return strictProperties(
    Object.fromEntries(Object.entries(value).filter(([key]) => !key.startsWith("__anvia_"))),
    label,
  );
}

function stringProperty(value: Record<string, unknown>, property: string): string | undefined {
  const item = value[property];
  if (item === undefined) return undefined;
  return stringValue(item, `Neo4j property ${property}`);
}

function stringArrayProperty(value: Record<string, unknown>, property: string): string[] {
  const item = value[property];
  if (item === undefined) return [];
  if (!Array.isArray(item) || !item.every((entry) => typeof entry === "string")) {
    throw new TypeError(`Neo4j property ${property} must be a string array.`);
  }
  return [...item];
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string") throw new TypeError(`${label} must be a string.`);
  return value;
}

function listOfMaps(value: unknown, label: string): Record<string, unknown>[] {
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === "object" && item !== null && !Array.isArray(item))
  ) {
    throw new TypeError(`${label} must be an array of objects.`);
  }
  return value as Record<string, unknown>[];
}

function escapeLucene(value: string): string {
  const specialCharacters = new Set('+-&|!(){}[]^"~*?:\\/');
  let escaped = "";
  for (const character of value) {
    escaped += specialCharacters.has(character) ? `\\${character}` : character;
  }
  return escaped;
}

function groupBy<Value, Key>(
  values: readonly Value[],
  keyFor: (value: Value) => Key,
): Map<Key, Value[]> {
  const groups = new Map<Key, Value[]>();
  for (const value of values) {
    const key = keyFor(value);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [value]);
    else group.push(value);
  }
  return groups;
}
