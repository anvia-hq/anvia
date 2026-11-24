import { createHash } from "node:crypto";
import type { GraphSchemaLike } from "@anvia/graph";
import type { Record as DriverRecord } from "neo4j-driver";
import { driverNumber, positiveInteger, quoteIdentifier } from "./helpers.js";
import type {
  ExistingMemgraphSeed,
  ManagedMemgraphKnowledgeGraphOptions,
  ManagedMemgraphResources,
  ManagedMemgraphTextShorthand,
  MemgraphTextIndex,
  MemgraphVectorIndex,
} from "./types.js";

type RegisteredTextIndex = MemgraphTextIndex & Readonly<{ properties: readonly string[] }>;
type MemgraphSeedRegistrationValues = {
  labels: readonly string[];
  vectorIndex: MemgraphVectorIndex & Readonly<{ property: string }>;
  textIndex?: RegisteredTextIndex | undefined;
  entryRelationshipType?: string | undefined;
};

export type MemgraphSeedRegistration = Readonly<MemgraphSeedRegistrationValues>;

export type ExpectedConstraint = Readonly<{
  label: string;
  properties: readonly string[];
}>;

export function validateExistingSeed(
  schema: GraphSchemaLike,
  seed: ExistingMemgraphSeed,
): MemgraphSeedRegistration {
  if (seed.nodeTypes.length === 0 || new Set(seed.nodeTypes).size !== seed.nodeTypes.length) {
    throw new TypeError("A Memgraph seed requires unique node types.");
  }

  for (const type of seed.nodeTypes) {
    assertName(type, "Memgraph seed node type");

    if (!(type in schema.nodes)) throw new TypeError(`Unknown Memgraph seed node type ${type}.`);
  }
  validateVectorIndex(seed.vectorIndex);
  assertName(seed.vectorIndex.property, "Memgraph vector property");

  if (seed.textIndex !== undefined) validateTextIndex(seed.textIndex, false);

  const registration: MemgraphSeedRegistrationValues = {
    labels: Object.freeze([...seed.nodeTypes]),
    vectorIndex: Object.freeze({ ...seed.vectorIndex }),
  };

  if (seed.textIndex !== undefined) {
    registration.textIndex = Object.freeze({
      ...seed.textIndex,
      properties: [...seed.textIndex.properties],
    });
  }

  return Object.freeze(registration);
}

export function resolveResources<Schema extends GraphSchemaLike>(
  options: ManagedMemgraphKnowledgeGraphOptions<Schema>,
): ManagedMemgraphResources {
  if ("resources" in options && options.resources !== undefined) {
    return options.resources;
  }

  const { labelPrefix, indexPrefix } = derivedResourcePrefixes(options.name);
  const similarity = options.similarity ?? "cosine";
  const dimensions = options.dimensions;
  const textShorthand = options.text ?? options.fulltext;
  const textIndexes = resolveTextShorthand(options.schema, indexPrefix, textShorthand);
  const chunks: { vector: MemgraphVectorIndex; text?: MemgraphTextIndex | undefined } = {
    vector: { name: `${indexPrefix}_chunks_vector`, dimensions, similarity },
  };
  const entities: { vector: MemgraphVectorIndex; text?: MemgraphTextIndex | undefined } = {
    vector: { name: `${indexPrefix}_entities_vector`, dimensions, similarity },
  };

  if (textIndexes.chunks !== undefined) chunks.text = textIndexes.chunks;

  if (textIndexes.entities !== undefined) entities.text = textIndexes.entities;

  return {
    labels: {
      document: `${labelPrefix}Document`,
      chunk: `${labelPrefix}Chunk`,
      entity: `${labelPrefix}Entity`,
    },
    indexes: { chunks, entities },
  };
}

function resolveTextShorthand(
  schema: GraphSchemaLike,
  indexPrefix: string,
  text: ManagedMemgraphTextShorthand | undefined,
): { chunks?: MemgraphTextIndex; entities?: MemgraphTextIndex } {
  if (text === undefined || text === false) return {};

  const entityProperties = [
    ...new Set(Object.values(schema.nodes).flatMap((node) => Object.keys(node.properties.shape))),
  ];

  if (text === true) {
    const result: { chunks?: MemgraphTextIndex; entities?: MemgraphTextIndex } = {
      chunks: { name: `${indexPrefix}_chunks_text` },
    };

    if (entityProperties.length > 0) {
      result.entities = { name: `${indexPrefix}_entities_text`, properties: entityProperties };
    }

    return result;
  }

  const result: { chunks?: MemgraphTextIndex; entities?: MemgraphTextIndex } = {};

  if (text.chunks === true) {
    result.chunks = { name: `${indexPrefix}_chunks_text` };
  } else if (typeof text.chunks === "object") {
    result.chunks = text.chunks;
  }

  if (text.entities === true) {
    if (entityProperties.length > 0) {
      result.entities = { name: `${indexPrefix}_entities_text`, properties: entityProperties };
    }
  } else if (Array.isArray(text.entities)) {
    result.entities = { name: `${indexPrefix}_entities_text`, properties: text.entities };
  } else if (typeof text.entities === "object") {
    result.entities = text.entities as MemgraphTextIndex;
  }

  return result;
}

const CANONICAL_GRAPH_NAME = /^[a-z][a-z0-9]*$/;

function derivedResourcePrefixes(name: string): { labelPrefix: string; indexPrefix: string } {
  if (CANONICAL_GRAPH_NAME.test(name)) {
    return {
      labelPrefix: `${name[0]?.toUpperCase() ?? ""}${name.slice(1)}`,
      indexPrefix: name,
    };
  }

  const suffix = createHash("sha256").update(name).digest("hex").slice(0, 8);
  return {
    labelPrefix: `${toPascalCase(name)}_${suffix}`,
    indexPrefix: `${toSnakeCase(name)}_${suffix}`,
  };
}

function toPascalCase(name: string): string {
  const parts = name
    .split(/[^A-Za-z0-9]+/)
    .filter((part) => part.length > 0)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`);
  return parts.length > 0 ? parts.join("") : "Graph";
}

function toSnakeCase(name: string): string {
  const normalized = name
    .replaceAll(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replaceAll(/[^A-Za-z0-9]+/g, "_")
    .replaceAll(/^_+|_+$/g, "")
    .toLowerCase();
  return normalized.length > 0 ? normalized : "graph";
}

export function validateResources(resources: ManagedMemgraphResources): ManagedMemgraphResources {
  const labels = Object.fromEntries(
    Object.entries(resources.labels).map(([key, value]) => [
      key,
      assertName(value, `${key} label`),
    ]),
  ) as typeof resources.labels;

  if (new Set(Object.values(labels)).size !== Object.values(labels).length) {
    throw new TypeError("Managed Memgraph resource labels must be unique.");
  }

  validateVectorIndex(resources.indexes.chunks.vector);
  validateVectorIndex(resources.indexes.entities.vector);

  if (resources.indexes.chunks.text !== undefined) {
    validateTextIndex(resources.indexes.chunks.text, true);
  }

  if (resources.indexes.entities.text !== undefined) {
    validateTextIndex(resources.indexes.entities.text, true);
  }

  const names = [
    resources.indexes.chunks.vector.name,
    resources.indexes.entities.vector.name,
    resources.indexes.chunks.text?.name,
    resources.indexes.entities.text?.name,
  ].filter((value): value is string => value !== undefined);

  if (new Set(names).size !== names.length) {
    throw new TypeError("Managed Memgraph index names must be unique.");
  }

  const chunks = freezeManagedIndex(resources.indexes.chunks);
  const entities = freezeManagedIndex(resources.indexes.entities);
  return Object.freeze({
    labels: Object.freeze(labels),
    indexes: Object.freeze({ chunks, entities }),
  });
}

export function seedRegistration(
  label: string,
  vectorIndex: MemgraphVectorIndex,
  property: string,
  textIndex: MemgraphTextIndex | undefined,
  textProperties: readonly string[],
  entryRelationshipType?: string,
): MemgraphSeedRegistration {
  const registration: MemgraphSeedRegistrationValues = {
    labels: Object.freeze([label]),
    vectorIndex: Object.freeze({ ...vectorIndex, property }),
  };

  if (textIndex !== undefined) {
    registration.textIndex = Object.freeze({
      ...textIndex,
      properties: Object.freeze([...textProperties]),
    });
  }

  if (entryRelationshipType !== undefined) {
    registration.entryRelationshipType = entryRelationshipType;
  }

  return Object.freeze(registration);
}

export function createVectorIndex(seed: MemgraphSeedRegistration): string {
  const index = seed.vectorIndex;
  const config = {
    dimension: index.dimensions,
    capacity: index.capacity ?? 100_000,
    metric: similarityName(index.similarity),
    resize_coefficient: index.resizeCoefficient ?? 2,
    scalar_kind: index.scalarKind ?? "f32",
  };
  return `CREATE VECTOR INDEX ${quoteIdentifier(index.name)} ON :${seed.labels
    .map(quoteIdentifier)
    .join("|")}(${quoteIdentifier(index.property)}) WITH CONFIG ${JSON.stringify(config)}`;
}

export function createTextIndex(seed: MemgraphSeedRegistration): string {
  const index = seed.textIndex;

  if (index === undefined) throw new TypeError("Cannot create an undefined Memgraph text index.");

  const properties =
    index.properties.length === 0 ? "" : `(${index.properties.map(quoteIdentifier).join(", ")})`;
  return `CREATE TEXT INDEX ${quoteIdentifier(index.name)} ON :${seed.labels
    .map(quoteIdentifier)
    .join("|")}${properties}`;
}

export function createConstraint(expected: ExpectedConstraint): string {
  const properties = expected.properties
    .map((property) => `n.${quoteIdentifier(property)}`)
    .join(", ");
  return `CREATE CONSTRAINT ON (n:${quoteIdentifier(expected.label)}) ASSERT ${properties} IS UNIQUE`;
}

export function createLookupIndex(expected: ExpectedConstraint): string {
  return `CREATE INDEX ON :${quoteIdentifier(expected.label)}(${expected.properties
    .map(quoteIdentifier)
    .join(", ")})`;
}

export function validateVectorRecord(record: DriverRecord, seed: MemgraphSeedRegistration): void {
  const index = seed.vectorIndex;
  const label = record.get("label");
  const property = record.get("property");
  const dimensions = driverNumber(record.get("dimension"), `${index.name} dimensions`);
  const metric = record.get("metric");

  if (
    dimensions !== index.dimensions ||
    property !== index.property ||
    metric !== similarityName(index.similarity) ||
    (typeof label === "string" && !seed.labels.some((value) => label.includes(value)))
  ) {
    throw new Error(`Memgraph vector index ${index.name} does not match its registration.`);
  }
}

export function constraintMatches(record: DriverRecord, expected: ExpectedConstraint): boolean {
  const values = recordValues(record);
  return (
    values.includes(expected.label) &&
    expected.properties.every((property) => values.some((value) => value === property)) &&
    values.some((value) => typeof value === "string" && value.toLowerCase().includes("unique"))
  );
}

export function indexMatches(record: DriverRecord, expected: ExpectedConstraint): boolean {
  const values = recordValues(record);
  return (
    values.includes(expected.label) &&
    expected.properties.every((property) => values.some((value) => value === property))
  );
}

export function recordContains(record: DriverRecord, expected: string | undefined): boolean {
  return (
    expected !== undefined &&
    recordValues(record).some(
      (value) => value === expected || (typeof value === "string" && value.includes(expected)),
    )
  );
}

export function firstString(record: DriverRecord): string | undefined {
  return recordValues(record).find((value): value is string => typeof value === "string");
}

export function assertName(value: string, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return value;
}

function validateVectorIndex(index: MemgraphVectorIndex): void {
  assertName(index.name, "Memgraph vector index name");
  positiveInteger(index.dimensions, `Memgraph vector index ${index.name} dimensions`);

  if (
    !(["cosine", "euclidean", "dotProduct", "inner-product"] as const).includes(index.similarity)
  ) {
    throw new TypeError(`Memgraph vector index ${index.name} has an unsupported similarity.`);
  }

  if (index.capacity !== undefined) positiveInteger(index.capacity, `${index.name} capacity`);

  if (index.resizeCoefficient !== undefined) {
    positiveInteger(index.resizeCoefficient, `${index.name} resize coefficient`);
  }
}

function validateTextIndex(index: MemgraphTextIndex, optionalProperties: boolean): void {
  assertName(index.name, "Memgraph text index name");

  if (!optionalProperties && index.properties === undefined) {
    throw new TypeError(`Existing Memgraph text index ${index.name} requires properties.`);
  }

  if (index.properties !== undefined) {
    if (new Set(index.properties).size !== index.properties.length) {
      throw new TypeError(`Memgraph text index ${index.name} properties must be unique.`);
    }

    for (const property of index.properties) assertName(property, "Memgraph text property");
  }
}

function similarityName(value: MemgraphVectorIndex["similarity"]): string {
  switch (value) {
    case "cosine":
      return "cos";
    case "euclidean":
      return "l2sq";
    case "dotProduct":
    case "inner-product":
      return "ip";
  }
}

function freezeManagedIndex(index: {
  vector: MemgraphVectorIndex;
  text?: MemgraphTextIndex | undefined;
}): Readonly<{ vector: MemgraphVectorIndex; text?: MemgraphTextIndex | undefined }> {
  const registration: { vector: MemgraphVectorIndex; text?: MemgraphTextIndex | undefined } = {
    vector: Object.freeze({ ...index.vector }),
  };

  if (index.text !== undefined) {
    registration.text = Object.freeze({ ...index.text });
  }

  return Object.freeze(registration);
}

function recordValues(record: DriverRecord): unknown[] {
  return record.keys.flatMap((key) => {
    const value = record.get(key);
    return Array.isArray(value) ? value : [value];
  });
}
