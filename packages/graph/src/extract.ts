import { Usage } from "@anvia/core";
import { extract } from "@anvia/core/extractor";
import { z } from "zod";
import { parseGraphProperties, parseGraphPropertyValue } from "./schema.js";
import type {
  ExtractGraphFactsOptions,
  ExtractGraphFactsResult,
  GraphEntity,
  GraphExtractionWarning,
  GraphFactConflictCandidate,
  GraphFactConflictPolicy,
  GraphFactPropertyConflict,
  GraphFactPropertyConflictStrategy,
  GraphFacts,
  GraphMention,
  GraphNodeIdentity,
  GraphProperties,
  GraphPropertyValue,
  GraphRelationship,
  GraphSchemaLike,
} from "./types.js";

type RawEntity = { ref: string; type: string; properties: Record<string, unknown> };
type RawRelationship = {
  type: string;
  from: string;
  to: string;
  properties: Record<string, unknown>;
};
type RawChunkFacts = { entities: RawEntity[]; relationships: RawRelationship[] };
type ChunkExtraction = { chunkId: string; output: RawChunkFacts; usage: Usage };
type EntityCandidate = Readonly<{
  key: string;
  type: string;
  identity: GraphNodeIdentity;
  properties: GraphProperties;
  chunkId: string;
}>;
type RelationshipCandidate = Readonly<{
  key: string;
  type: string;
  from: string;
  to: string;
  identity: GraphNodeIdentity;
  properties: GraphProperties;
  chunkId: string;
}>;

export async function extractGraphFacts<
  Schema extends GraphSchemaLike,
  Model extends import("@anvia/core").CompletionModel,
>(options: ExtractGraphFactsOptions<Schema, Model>): Promise<ExtractGraphFactsResult<Schema>> {
  assertConcurrency(options.concurrency);
  throwIfAborted(options.abortSignal);
  const ids = new Set<string>();
  for (const chunk of options.chunks) {
    if (ids.has(chunk.id)) throw new TypeError(`Duplicate graph chunk id: ${chunk.id}`);
    ids.add(chunk.id);
    if (typeof chunk.text !== "string") {
      throw new TypeError(`Graph chunk ${chunk.id} text must be a string.`);
    }
  }

  const outputSchema = extractionSchema(options.schema);
  const instructions = graphInstructions(options.schema, options.instructions);
  const extractions = await mapConcurrent(
    options.chunks,
    options.concurrency ?? 1,
    async (chunk): Promise<ChunkExtraction> => {
      throwIfAborted(options.abortSignal);
      const result = await extract({
        model: options.model,
        text: chunk.text,
        outputSchema,
        instructions,
        retries: options.retries,
        abortSignal: options.abortSignal,
      });
      return { chunkId: chunk.id, output: result.output as RawChunkFacts, usage: result.usage };
    },
  );
  return {
    ...normalizeFacts(options.schema, extractions, options.conflicts),
    usage: extractions.reduce((usage, item) => Usage.add(usage, item.usage), Usage.empty()),
  };
}

function extractionSchema(schema: GraphSchemaLike): z.ZodType<RawChunkFacts> {
  const entities = Object.entries(schema.nodes).map(([type, definition]) =>
    z.object({ ref: z.string().min(1), type: z.literal(type), properties: definition.properties }),
  );
  const relationships = Object.entries(schema.relationships).map(([type, definition]) =>
    z.object({
      type: z.literal(type),
      from: z.string().min(1),
      to: z.string().min(1),
      properties: definition.properties,
    }),
  );
  return z.object({
    entities: z.array(union(entities, z.never())),
    relationships: z.array(union(relationships, z.never())),
  }) as unknown as z.ZodType<RawChunkFacts>;
}

function union(items: z.ZodType[], empty: z.ZodType): z.ZodType {
  if (items.length === 0) return empty;
  if (items.length === 1) return items[0] as z.ZodType;
  return z.union(items as [z.ZodType, z.ZodType, ...z.ZodType[]]);
}

function graphInstructions(schema: GraphSchemaLike, extra: string | undefined): string {
  const nodes = Object.entries(schema.nodes)
    .map(([type, definition]) => `- ${type}: ${definition.description}`)
    .join("\n");
  const relationships = Object.entries(schema.relationships)
    .map(
      ([type, definition]) =>
        `- ${type}: ${definition.from} -> ${definition.to}. ${definition.description}`,
    )
    .join("\n");
  return [
    "Extract only facts directly supported by the source text.",
    "Give every extracted entity a unique local ref and use those refs as relationship endpoints.",
    "Do not invent entity or relationship types outside the declared schema.",
    `Node types:\n${nodes}`,
    relationships.length === 0
      ? "No relationship types are allowed."
      : `Relationship types:\n${relationships}`,
    extra,
  ]
    .filter((part): part is string => part !== undefined && part.length > 0)
    .join("\n\n");
}

function normalizeFacts<Schema extends GraphSchemaLike>(
  schema: Schema,
  extractions: readonly ChunkExtraction[],
  conflicts: ExtractGraphFactsOptions<Schema, import("@anvia/core").CompletionModel>["conflicts"],
): Readonly<{ output: GraphFacts<Schema>; warnings: readonly GraphExtractionWarning[] }> {
  const entityCandidates = new Map<string, EntityCandidate[]>();
  const relationshipCandidates = new Map<string, RelationshipCandidate[]>();
  const mentions = new Map<string, GraphMention>();

  for (const extraction of extractions) {
    const refs = new Map<string, EntityCandidate>();
    for (const raw of extraction.output.entities) {
      if (refs.has(raw.ref)) {
        throw new TypeError(`Duplicate entity ref ${raw.ref} in chunk ${extraction.chunkId}.`);
      }
      const definition = schema.nodes[raw.type];
      if (definition === undefined) throw new TypeError(`Unknown graph entity type: ${raw.type}`);
      const properties = parseGraphProperties(
        definition.properties.parse(raw.properties),
        `entity ${raw.type}`,
      );
      const identity = identityFromProperties(definition.identity, properties, raw.type);
      const key = `${raw.type}:${stableObject(identity)}`;
      const candidate: EntityCandidate = {
        key,
        type: raw.type,
        identity,
        properties,
        chunkId: extraction.chunkId,
      };
      appendCandidate(entityCandidates, key, candidate);
      refs.set(raw.ref, candidate);
      mentions.set(`${extraction.chunkId}\u0000${key}`, {
        chunkId: extraction.chunkId,
        entityKey: key,
      });
    }

    for (const raw of extraction.output.relationships) {
      const definition = schema.relationships[raw.type];
      if (definition === undefined) {
        throw new TypeError(`Unknown graph relationship type: ${raw.type}`);
      }
      const from = refs.get(raw.from);
      const to = refs.get(raw.to);
      if (from === undefined || to === undefined) {
        throw new TypeError(
          `Relationship ${raw.type} in chunk ${extraction.chunkId} references an unknown entity ref.`,
        );
      }
      if (from.type !== definition.from || to.type !== definition.to) {
        throw new TypeError(
          `Relationship ${raw.type} has invalid endpoint types ${from.type} -> ${to.type}.`,
        );
      }
      const properties = parseGraphProperties(
        definition.properties.parse(raw.properties),
        `relationship ${raw.type}`,
      );
      const identity = identityFromProperties(definition.identity ?? [], properties, raw.type);
      const key = `${raw.type}:${from.key}->${to.key}:${stableObject(identity)}`;
      appendCandidate(relationshipCandidates, key, {
        key,
        type: raw.type,
        from: from.key,
        to: to.key,
        identity,
        properties,
        chunkId: extraction.chunkId,
      });
    }
  }
  const warnings: GraphExtractionWarning[] = [];
  const entities = [...entityCandidates.values()].map((candidates) => {
    const first = requiredCandidate(candidates);
    const definition = schema.nodes[first.type];
    if (definition === undefined) throw new TypeError(`Unknown graph entity type: ${first.type}`);
    const properties = parseGraphProperties(
      definition.properties.parse(
        resolveFactProperties(
          "entity",
          first.key,
          first.type,
          first.identity,
          candidates,
          conflicts?.entity,
          warnings,
        ),
      ),
      `entity ${first.type}`,
    );
    return {
      key: first.key,
      type: first.type,
      identity: first.identity,
      properties,
      sourceChunkIds: uniqueChunkIds(candidates),
    } as GraphEntity<Schema>;
  });
  const relationships = [...relationshipCandidates.values()].map((candidates) => {
    const first = requiredCandidate(candidates);
    const definition = schema.relationships[first.type];
    if (definition === undefined) {
      throw new TypeError(`Unknown graph relationship type: ${first.type}`);
    }
    const properties = parseGraphProperties(
      definition.properties.parse(
        resolveFactProperties(
          "relationship",
          first.key,
          first.type,
          first.identity,
          candidates,
          conflicts?.relationship,
          warnings,
        ),
      ),
      `relationship ${first.type}`,
    );
    return {
      key: first.key,
      type: first.type,
      from: first.from,
      to: first.to,
      properties,
      sourceChunkIds: uniqueChunkIds(candidates),
    } as GraphRelationship<Schema>;
  });
  return {
    output: { entities, relationships, mentions: [...mentions.values()] },
    warnings,
  };
}

function appendCandidate<Candidate>(
  candidates: Map<string, Candidate[]>,
  key: string,
  candidate: Candidate,
): void {
  const current = candidates.get(key);
  if (current === undefined) candidates.set(key, [candidate]);
  else current.push(candidate);
}

function requiredCandidate<Candidate>(candidates: readonly Candidate[]): Candidate {
  const candidate = candidates[0];
  if (candidate === undefined) throw new TypeError("Graph fact candidate group cannot be empty.");
  return candidate;
}

function uniqueChunkIds(candidates: readonly { chunkId: string }[]): readonly string[] {
  return [...new Set(candidates.map((candidate) => candidate.chunkId))];
}

function resolveFactProperties(
  kind: "entity" | "relationship",
  key: string,
  type: string,
  identity: GraphNodeIdentity,
  candidates: readonly { chunkId: string; properties: GraphProperties }[],
  policy: GraphFactConflictPolicy | undefined,
  warnings: GraphExtractionWarning[],
): GraphProperties {
  const propertyNames = [
    ...new Set(candidates.flatMap((candidate) => Object.keys(candidate.properties))),
  ].sort();
  const properties: Record<string, GraphPropertyValue> = {};
  for (const property of propertyNames) {
    const propertyCandidates: GraphFactConflictCandidate[] = candidates.map((candidate) => ({
      chunkId: candidate.chunkId,
      properties: candidate.properties,
      value: candidate.properties[property],
    }));
    const firstValue = propertyCandidates[0]?.value;
    if (
      propertyCandidates.every(
        (candidate) => stableValue(candidate.value) === stableValue(firstValue),
      )
    ) {
      if (firstValue !== undefined) properties[property] = firstValue;
      continue;
    }
    const conflict: GraphFactPropertyConflict = {
      code: "GRAPH_FACT_CONFLICT",
      kind,
      key,
      type,
      identity,
      property,
      candidates: propertyCandidates,
      sourceChunkIds: uniqueChunkIds(propertyCandidates),
    };
    const strategy =
      policy?.properties?.[property] ?? policy?.resolve ?? policy?.default ?? "reject";
    if (strategy === "reject") throw new GraphFactConflictError(conflict);
    const resolvedValue = validateResolvedValue(
      resolvePropertyConflict(strategy, conflict),
      conflict,
    );
    if (resolvedValue !== undefined) properties[property] = resolvedValue;
    warnings.push({
      ...conflict,
      code: "GRAPH_FACT_CONFLICT_RESOLVED",
      strategy: typeof strategy === "function" ? "custom" : strategy,
      resolvedValue,
    });
  }
  return properties;
}

function resolvePropertyConflict(
  strategy: Exclude<GraphFactPropertyConflictStrategy, "reject">,
  conflict: GraphFactPropertyConflict,
): GraphPropertyValue | undefined {
  if (typeof strategy === "function") {
    return strategy(conflict);
  }
  const values = conflict.candidates.map((candidate) => candidate.value);
  if (strategy === "prefer-first") return values[0];
  if (strategy === "prefer-last") return values.at(-1);
  if (strategy === "prefer-defined") return values.find((value) => value !== undefined);
  if (strategy === "prefer-longest") {
    const strings = definedValues(values, "string", conflict, strategy);
    return strings.reduce((longest, value) => (value.length > longest.length ? value : longest));
  }
  if (strategy === "union") {
    const arrays = values.filter((value) => value !== undefined);
    if (!arrays.every(Array.isArray)) throw incompatibleStrategy(conflict, strategy);
    return [...new Set(arrays.flat())] as string[] | number[] | boolean[];
  }
  const numbers = definedValues(values, "number", conflict, strategy);
  return strategy === "max" ? Math.max(...numbers) : Math.min(...numbers);
}

function definedValues<Type extends "string" | "number">(
  values: readonly (GraphPropertyValue | undefined)[],
  type: Type,
  conflict: GraphFactPropertyConflict,
  strategy: string,
): Type extends "string" ? string[] : number[] {
  const defined = values.filter((value) => value !== undefined);
  if (defined.length === 0 || !defined.every((value) => typeof value === type)) {
    throw incompatibleStrategy(conflict, strategy);
  }
  return defined as Type extends "string" ? string[] : number[];
}

function validateResolvedValue(
  value: GraphPropertyValue | undefined,
  conflict: GraphFactPropertyConflict,
): GraphPropertyValue | undefined {
  return value === undefined
    ? undefined
    : parseGraphPropertyValue(value, `Resolved graph fact ${conflict.key}.${conflict.property}`);
}

function incompatibleStrategy(conflict: GraphFactPropertyConflict, strategy: string): TypeError {
  return new TypeError(
    `Graph fact conflict strategy ${strategy} is incompatible with ${conflict.key}.${conflict.property}.`,
  );
}

function identityFromProperties(
  keys: readonly string[],
  properties: GraphProperties,
  type: string,
): GraphNodeIdentity {
  const identity: Record<string, string | number | boolean> = {};
  for (const key of keys) {
    const value = properties[key];
    if (
      value === undefined ||
      !(typeof value === "string" || typeof value === "number" || typeof value === "boolean")
    ) {
      throw new TypeError(`Identity property ${key} for ${type} must be a primitive value.`);
    }
    identity[key] = value;
  }
  return identity;
}

function stableObject(value: Readonly<Record<string, unknown>>): string {
  return JSON.stringify(
    Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))),
  );
}

function stableValue(value: unknown): string {
  return value === undefined ? "undefined" : stableObject({ value });
}

export class GraphFactConflictError extends Error {
  readonly code = "GRAPH_FACT_CONFLICT" as const;
  readonly kind: "entity" | "relationship";
  readonly factKey: string;
  readonly type: string;
  readonly identity: GraphNodeIdentity;
  readonly property: string;
  readonly candidates: readonly GraphFactConflictCandidate[];
  readonly sourceChunkIds: readonly string[];

  constructor(conflict: GraphFactPropertyConflict);
  constructor(factKey: string, sourceChunkIds: readonly string[]);
  constructor(
    conflictOrKey: GraphFactPropertyConflict | string,
    legacyChunkIds: readonly string[] = [],
  ) {
    const conflict =
      typeof conflictOrKey === "string"
        ? {
            code: "GRAPH_FACT_CONFLICT" as const,
            kind: "entity" as const,
            key: conflictOrKey,
            type: conflictOrKey.split(":", 1)[0] ?? "unknown",
            identity: {},
            property: "unknown",
            candidates: [],
            sourceChunkIds: legacyChunkIds,
          }
        : conflictOrKey;
    super(
      `Conflicting graph fact ${conflict.key}.${conflict.property} was extracted from chunks ${conflict.sourceChunkIds.join(", ")}.`,
    );
    this.name = "GraphFactConflictError";
    this.kind = conflict.kind;
    this.factKey = conflict.key;
    this.type = conflict.type;
    this.identity = conflict.identity;
    this.property = conflict.property;
    this.candidates = conflict.candidates;
    this.sourceChunkIds = conflict.sourceChunkIds;
  }
}

function assertConcurrency(value: number | undefined): void {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < 1)) {
    throw new RangeError("Graph extraction concurrency must be a positive safe integer.");
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted !== true) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new DOMException("The operation was aborted.", "AbortError");
}

async function mapConcurrent<Input, Output>(
  values: readonly Input[],
  concurrency: number,
  run: (value: Input) => Promise<Output>,
): Promise<Output[]> {
  const output = Array<Output>(values.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      for (;;) {
        const index = cursor;
        cursor += 1;
        if (index >= values.length) return;
        output[index] = await run(values[index] as Input);
      }
    }),
  );
  return output;
}
