import type {
  GraphEvidenceCapability,
  GraphEvidenceInputFor,
  GraphEvidenceOptions,
  GraphSchemaLike,
  GraphSearchInput,
  GraphSearchOptions,
  GraphTraversalInput,
  GraphTraversalOptions,
} from "./types.js";

export const DEFAULT_GRAPH_SEARCH_TOP_K = 8;
export const DEFAULT_GRAPH_HYBRID_RRF_K = 60;
export const DEFAULT_GRAPH_TRAVERSAL_MAX_DEPTH = 2;
export const DEFAULT_GRAPH_TRAVERSAL_MAX_NODES = 40;
export const DEFAULT_GRAPH_TRAVERSAL_MAX_RELATIONSHIPS = 80;
export const DEFAULT_GRAPH_EVIDENCE_MAX_CHUNKS = 12;

export type ResolvedGraphRetrieveOptions<Schema extends GraphSchemaLike = GraphSchemaLike> =
  Readonly<{
    search: GraphSearchOptions;
    traversal: GraphTraversalOptions<Schema>;
    evidence: GraphEvidenceOptions;
  }>;

export function resolveGraphRetrieveOptions<
  Schema extends GraphSchemaLike,
  Evidence extends GraphEvidenceCapability,
>(
  config: Readonly<{
    schema: Schema;
    evidenceCapability: Evidence;
    availableSeeds: readonly string[];
    hybridSeeds?: readonly string[] | undefined;
  }>,
  options: Readonly<{
    search?: GraphSearchInput | undefined;
    traversal?: GraphTraversalInput<Schema> | undefined;
    evidence?: GraphEvidenceInputFor<Evidence> | undefined;
  }> = {},
): ResolvedGraphRetrieveOptions<Schema> {
  const search = resolveSearch(config.availableSeeds, config.hybridSeeds, options.search);
  const traversal = resolveTraversal(config.schema, options.traversal);
  const evidence = resolveEvidence(config.evidenceCapability, options.evidence);
  return { search, traversal, evidence };
}

function resolveSearch(
  availableSeeds: readonly string[],
  hybridSeeds: readonly string[] | undefined,
  input: GraphSearchInput | undefined,
): GraphSearchOptions {
  const type = input?.type ?? "vector";
  const topK = positiveInteger(input?.topK ?? DEFAULT_GRAPH_SEARCH_TOP_K, "Graph search topK");

  if (type === "vector") {
    const defaultSeed = availableSeeds.includes("entities") ? "entities" : availableSeeds[0];
    let seeds: string[];

    if (input?.seeds !== undefined) {
      seeds = [...input.seeds];
    } else if (defaultSeed !== undefined) {
      seeds = [defaultSeed];
    } else {
      seeds = [];
    }

    if (seeds.length === 0 || new Set(seeds).size !== seeds.length) {
      throw new TypeError("Graph search requires unique seed names.");
    }

    if (seeds.length !== 1) {
      throw new TypeError(
        "Vector graph search accepts exactly one seed; use hybrid search to fuse multiple seeds.",
      );
    }

    const minScore = input?.type !== "hybrid" ? input?.minScore : undefined;

    if (minScore !== undefined && !Number.isFinite(minScore)) {
      throw new RangeError("Graph search minScore must be a finite number.");
    }

    return minScore === undefined
      ? { type: "vector", seeds, topK }
      : { type: "vector", seeds, topK, minScore };
  }

  if (type !== "hybrid") {
    throw new TypeError(`Unsupported graph search type: ${String(type)}`);
  }

  const defaultHybridSeeds =
    hybridSeeds !== undefined && hybridSeeds.length > 0 ? hybridSeeds : availableSeeds;
  const seeds = input?.seeds !== undefined ? [...input.seeds] : [...defaultHybridSeeds];

  if (seeds.length === 0 || new Set(seeds).size !== seeds.length) {
    throw new TypeError("Graph search requires unique seed names.");
  }

  const hybridInput = input as Extract<GraphSearchInput, { type: "hybrid" }>;
  const candidatesPerSeed = positiveInteger(
    hybridInput.candidatesPerSeed ?? Math.max(topK * 3, 20),
    "Graph hybrid candidatesPerSeed",
  );
  const rrfK = positiveInteger(hybridInput.rrfK ?? DEFAULT_GRAPH_HYBRID_RRF_K, "Graph hybrid rrfK");
  return { type: "hybrid", seeds, topK, candidatesPerSeed, rrfK };
}

function resolveTraversal<Schema extends GraphSchemaLike>(
  schema: Schema,
  input: GraphTraversalInput<Schema> | undefined,
): GraphTraversalOptions<Schema> {
  const direction = input?.direction ?? "both";

  if (direction !== "outgoing" && direction !== "incoming" && direction !== "both") {
    throw new TypeError("Graph traversal direction must be outgoing, incoming, or both.");
  }

  const maxDepth = positiveInteger(
    input?.maxDepth ?? DEFAULT_GRAPH_TRAVERSAL_MAX_DEPTH,
    "Graph traversal maxDepth",
    8,
  );
  const maxNodes = positiveInteger(
    input?.maxNodes ?? DEFAULT_GRAPH_TRAVERSAL_MAX_NODES,
    "Graph traversal maxNodes",
  );
  const maxRelationships = positiveInteger(
    input?.maxRelationships ?? DEFAULT_GRAPH_TRAVERSAL_MAX_RELATIONSHIPS,
    "Graph traversal maxRelationships",
  );

  const relationships =
    input?.relationships !== undefined
      ? [...input.relationships]
      : (Object.keys(schema.relationships) as Array<keyof Schema["relationships"] & string>);

  if (new Set(relationships).size !== relationships.length) {
    throw new TypeError("Graph traversal requires unique relationship types.");
  }

  for (const type of relationships) {
    if (!(type in schema.relationships)) {
      throw new TypeError(`Graph traversal references unknown relationship type ${type}.`);
    }
  }

  return { relationships, direction, maxDepth, maxNodes, maxRelationships };
}

function resolveEvidence<Evidence extends GraphEvidenceCapability>(
  capability: Evidence,
  input: GraphEvidenceInputFor<Evidence> | undefined,
): GraphEvidenceOptions {
  if (input === undefined) {
    return capability === "chunks"
      ? { type: "chunks", maxChunks: DEFAULT_GRAPH_EVIDENCE_MAX_CHUNKS }
      : { type: "none" };
  }

  if (typeof input !== "object" || input === null) {
    throw new TypeError("Graph retrieval evidence must be an object.");
  }

  if (input.type === "none") {
    return { type: "none" };
  }

  if (input.type !== "chunks") {
    throw new TypeError("Unknown graph evidence mode.");
  }

  const maxChunks = positiveInteger(
    input.maxChunks ?? DEFAULT_GRAPH_EVIDENCE_MAX_CHUNKS,
    "Graph evidence maxChunks",
  );

  if (capability !== "chunks") {
    throw new TypeError("Chunk evidence requires a managed knowledge graph.");
  }

  return { type: "chunks", maxChunks };
}

function positiveInteger(value: number, label: string, maximum?: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || (maximum !== undefined && value > maximum)) {
    throw new RangeError(
      maximum === undefined
        ? `${label} must be a positive safe integer.`
        : `${label} must be an integer between 1 and ${maximum}.`,
    );
  }

  return value;
}
