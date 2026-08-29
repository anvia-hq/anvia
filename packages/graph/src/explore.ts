import type { GraphExploreDirection, GraphExploreOptions, GraphSchemaLike } from "./types.js";

const defaultMaxNodes = 100;
const maximumNodes = 500;
const defaultMaxRelationships = 200;
const maximumRelationships = 1_000;
const defaultMaxDepth = 1;
const maximumDepth = 4;
const maximumRoots = 20;

type ResolvedGraphExploreBase = Readonly<{
  nodeTypes: readonly string[];
  relationships: readonly string[];
  maxNodes: number;
  maxRelationships: number;
  includeProvenance: boolean;
  abortSignal?: AbortSignal | undefined;
}>;

export type ResolvedGraphExploreOverviewOptions = ResolvedGraphExploreBase &
  Readonly<{ mode: "overview" }>;

export type ResolvedGraphExploreExpandOptions = ResolvedGraphExploreBase &
  Readonly<{
    mode: "expand";
    nodeIds: readonly string[];
    direction: GraphExploreDirection;
    maxDepth: number;
  }>;

export type ResolvedGraphExploreOptions =
  | ResolvedGraphExploreOverviewOptions
  | ResolvedGraphExploreExpandOptions;

export function resolveGraphExploreOptions<Schema extends GraphSchemaLike>(
  schema: Schema,
  options: GraphExploreOptions<Schema>,
): ResolvedGraphExploreOptions {
  const nodeTypes = resolveNames(options.nodeTypes, Object.keys(schema.nodes), "node type");
  const relationships = resolveNames(
    options.relationships,
    Object.keys(schema.relationships),
    "relationship type",
    true,
  );
  const base: {
    nodeTypes: string[];
    relationships: string[];
    maxNodes: number;
    maxRelationships: number;
    includeProvenance: boolean;
    abortSignal?: AbortSignal | undefined;
  } = {
    nodeTypes,
    relationships,
    maxNodes: boundedInteger(options.maxNodes, defaultMaxNodes, maximumNodes, "maxNodes"),
    maxRelationships: boundedInteger(
      options.maxRelationships,
      defaultMaxRelationships,
      maximumRelationships,
      "maxRelationships",
    ),
    includeProvenance: options.includeProvenance ?? false,
  };
  if (options.abortSignal !== undefined) base.abortSignal = options.abortSignal;
  if (options.mode === "overview") {
    return { ...base, mode: "overview" };
  }
  const nodeIds = uniqueNonEmptyStrings(options.nodeIds, "node id");
  if (nodeIds.length === 0) {
    throw new TypeError("Graph expansion requires at least one node id.");
  }
  if (nodeIds.length > maximumRoots) {
    throw new RangeError(`Graph expansion accepts at most ${maximumRoots} root nodes.`);
  }
  const direction = options.direction ?? "both";
  if (direction !== "outgoing" && direction !== "incoming" && direction !== "both") {
    throw new TypeError("Graph expansion direction must be outgoing, incoming, or both.");
  }
  return {
    ...base,
    mode: "expand",
    nodeIds,
    direction,
    maxDepth: boundedInteger(options.maxDepth, defaultMaxDepth, maximumDepth, "maxDepth"),
  };
}

function resolveNames(
  selected: readonly string[] | undefined,
  available: readonly string[],
  label: string,
  allowEmpty = false,
): string[] {
  const values = selected === undefined ? [...available] : uniqueNonEmptyStrings(selected, label);
  if (!allowEmpty && values.length === 0) {
    throw new TypeError(`Graph exploration requires at least one ${label}.`);
  }
  const known = new Set(available);
  for (const value of values) {
    if (!known.has(value))
      throw new TypeError(`Graph exploration references unknown ${label} ${value}.`);
  }
  return values;
}

function uniqueNonEmptyStrings(values: readonly string[], label: string): string[] {
  const unique = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string" || value.length === 0) {
      throw new TypeError(`Graph ${label} must be a non-empty string.`);
    }
    if (unique.has(value)) throw new TypeError(`Duplicate graph ${label}: ${value}.`);
    unique.add(value);
  }
  return [...unique];
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  maximum: number,
  label: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > maximum) {
    throw new RangeError(`Graph exploration ${label} must be between 1 and ${maximum}.`);
  }
  return resolved;
}
