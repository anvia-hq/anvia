import { Usage } from "@anvia/core";
import { extract } from "@anvia/core/extractor";
import { z } from "zod";
import { throwIfAborted } from "./helpers.js";
import { parseNeo4jProperties } from "./schema.js";
import type {
  ExtractGraphFactsOptions,
  ExtractGraphFactsResult,
  Neo4jGraphEntity,
  Neo4jGraphFacts,
  Neo4jGraphMention,
  Neo4jGraphRelationship,
  Neo4jGraphSchema,
  Neo4jNodeIdentity,
  Neo4jProperties,
} from "./types.js";

type RawEntity = {
  ref: string;
  type: string;
  properties: Record<string, unknown>;
};

type RawRelationship = {
  type: string;
  from: string;
  to: string;
  properties: Record<string, unknown>;
};

type RawChunkFacts = {
  entities: RawEntity[];
  relationships: RawRelationship[];
};

type ChunkExtraction = {
  chunkId: string;
  output: RawChunkFacts;
  usage: Usage;
};

export async function extractGraphFacts<
  Schema extends Neo4jGraphSchema,
  Model extends import("@anvia/core").CompletionModel,
>(options: ExtractGraphFactsOptions<Schema, Model>): Promise<ExtractGraphFactsResult<Schema>> {
  assertConcurrency(options.concurrency);
  throwIfAborted(options.abortSignal);
  const ids = new Set<string>();
  for (const chunk of options.chunks) {
    if (ids.has(chunk.id)) throw new TypeError(`Duplicate graph chunk id: ${chunk.id}`);
    ids.add(chunk.id);
    if (typeof chunk.text !== "string")
      throw new TypeError(`Graph chunk ${chunk.id} text must be a string.`);
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
    output: normalizeFacts(options.schema, extractions),
    usage: extractions.reduce((usage, item) => Usage.add(usage, item.usage), Usage.empty()),
  };
}

function extractionSchema(schema: Neo4jGraphSchema): z.ZodType<RawChunkFacts> {
  const entityVariants = Object.entries(schema.nodes).map(([type, definition]) =>
    z.object({
      ref: z.string().min(1),
      type: z.literal(type),
      properties: definition.properties,
    }),
  );
  const relationshipVariants = Object.entries(schema.relationships).map(([type, definition]) =>
    z.object({
      type: z.literal(type),
      from: z.string().min(1),
      to: z.string().min(1),
      properties: definition.properties,
    }),
  );
  const entity = union(entityVariants, z.never());
  const relationship = union(relationshipVariants, z.never());
  return z.object({
    entities: z.array(entity),
    relationships: z.array(relationship),
  }) as unknown as z.ZodType<RawChunkFacts>;
}

function union(items: z.ZodType[], empty: z.ZodType): z.ZodType {
  if (items.length === 0) return empty;
  if (items.length === 1) return items[0] as z.ZodType;
  return z.union(items as [z.ZodType, z.ZodType, ...z.ZodType[]]);
}

function graphInstructions(schema: Neo4jGraphSchema, instructions: string | undefined): string {
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
    instructions,
  ]
    .filter((part): part is string => part !== undefined && part.length > 0)
    .join("\n\n");
}

function normalizeFacts<Schema extends Neo4jGraphSchema>(
  schema: Schema,
  extractions: readonly ChunkExtraction[],
): Neo4jGraphFacts<Schema> {
  const entities = new Map<string, Neo4jGraphEntity<Schema>>();
  const relationships = new Map<string, Neo4jGraphRelationship<Schema>>();
  const mentions = new Map<string, Neo4jGraphMention>();

  for (const extraction of extractions) {
    const refs = new Map<string, Neo4jGraphEntity<Schema>>();
    for (const raw of extraction.output.entities) {
      if (refs.has(raw.ref))
        throw new TypeError(`Duplicate entity ref ${raw.ref} in chunk ${extraction.chunkId}.`);
      const definition = schema.nodes[raw.type];
      if (definition === undefined) throw new TypeError(`Unknown graph entity type: ${raw.type}`);
      const properties = parseNeo4jProperties(
        definition.properties.parse(raw.properties),
        `entity ${raw.type}`,
      );
      const identity = identityFromProperties(definition.identity, properties, raw.type);
      const key = entityKey(raw.type, identity);
      const current = entities.get(key);
      const next = {
        key,
        type: raw.type,
        identity,
        properties,
        sourceChunkIds: [extraction.chunkId],
      } as unknown as Neo4jGraphEntity<Schema>;
      if (current === undefined) {
        entities.set(key, next);
        refs.set(raw.ref, next);
      } else {
        assertSameProperties(
          current.properties,
          properties,
          key,
          current.sourceChunkIds,
          extraction.chunkId,
        );
        const merged = {
          ...current,
          sourceChunkIds: [...current.sourceChunkIds, extraction.chunkId],
        } as Neo4jGraphEntity<Schema>;
        entities.set(key, merged);
        refs.set(raw.ref, merged);
      }
      mentions.set(`${extraction.chunkId}\u0000${key}`, {
        chunkId: extraction.chunkId,
        entityKey: key,
      });
    }

    for (const raw of extraction.output.relationships) {
      const definition = schema.relationships[raw.type];
      if (definition === undefined)
        throw new TypeError(`Unknown graph relationship type: ${raw.type}`);
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
      const properties = parseNeo4jProperties(
        definition.properties.parse(raw.properties),
        `relationship ${raw.type}`,
      );
      const identity = identityFromProperties(definition.identity ?? [], properties, raw.type);
      const key = relationshipKey(raw.type, from.key, to.key, identity);
      const current = relationships.get(key);
      const next = {
        key,
        type: raw.type,
        from: from.key,
        to: to.key,
        properties,
        sourceChunkIds: [extraction.chunkId],
      } as unknown as Neo4jGraphRelationship<Schema>;
      if (current === undefined) relationships.set(key, next);
      else {
        assertSameProperties(
          current.properties,
          properties,
          key,
          current.sourceChunkIds,
          extraction.chunkId,
        );
        relationships.set(key, {
          ...current,
          sourceChunkIds: [...current.sourceChunkIds, extraction.chunkId],
        } as Neo4jGraphRelationship<Schema>);
      }
    }
  }

  return {
    entities: [...entities.values()],
    relationships: [...relationships.values()],
    mentions: [...mentions.values()],
  };
}

function identityFromProperties(
  keys: readonly string[],
  properties: Neo4jProperties,
  type: string,
): Neo4jNodeIdentity {
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

function entityKey(type: string, identity: Neo4jNodeIdentity): string {
  return `${type}:${stableObject(identity)}`;
}

function relationshipKey(
  type: string,
  from: string,
  to: string,
  identity: Neo4jNodeIdentity,
): string {
  return `${type}:${from}->${to}:${stableObject(identity)}`;
}

function stableObject(value: Readonly<Record<string, unknown>>): string {
  return JSON.stringify(
    Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))),
  );
}

function assertSameProperties(
  left: Neo4jProperties,
  right: Neo4jProperties,
  key: string,
  sourceChunkIds: readonly string[],
  nextChunkId: string,
): void {
  if (stableObject(left) !== stableObject(right)) {
    throw new GraphFactConflictError(key, [...sourceChunkIds, nextChunkId]);
  }
}

export class GraphFactConflictError extends Error {
  constructor(
    readonly factKey: string,
    readonly sourceChunkIds: readonly string[],
  ) {
    super(
      `Conflicting graph fact ${factKey} was extracted from chunks ${sourceChunkIds.join(", ")}.`,
    );
    this.name = "GraphFactConflictError";
  }
}

function assertConcurrency(value: number | undefined): void {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < 1)) {
    throw new RangeError("Graph extraction concurrency must be a positive safe integer.");
  }
}

async function mapConcurrent<Input, Output>(
  values: readonly Input[],
  concurrency: number,
  run: (value: Input) => Promise<Output>,
): Promise<Output[]> {
  const output = new Array<Output>(values.length);
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
