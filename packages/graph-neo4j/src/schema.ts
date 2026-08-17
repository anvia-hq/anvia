import { z } from "zod";
import type {
  Neo4jGraphSchema,
  Neo4jGraphSchemaOptions,
  Neo4jProperties,
  Neo4jPropertyPrimitive,
  Neo4jPropertyValue,
} from "./types.js";

const reservedPrefix = "__anvia_";

export function defineNeo4jGraphSchema<const Options extends Neo4jGraphSchemaOptions>(
  options: Options,
): Neo4jGraphSchema<Options> {
  if (Object.keys(options.nodes).length === 0) {
    throw new TypeError("A Neo4j graph schema requires at least one node type.");
  }
  for (const [type, definition] of Object.entries(options.nodes)) {
    assertName(type, "node type");
    assertDescription(definition.description, `node ${type}`);
    if (!(definition.properties instanceof z.ZodObject)) {
      throw new TypeError(`Properties for node ${type} must be a Zod object schema.`);
    }
    assertExactPropertySchema(definition.properties, `node ${type}`);
    if (
      definition.identity.length === 0 ||
      new Set(definition.identity).size !== definition.identity.length
    ) {
      throw new TypeError(`Node ${type} must declare unique identity properties.`);
    }
    const shape = definition.properties.shape;
    for (const property of definition.identity) {
      assertPropertyName(property);
      if (!(property in shape)) {
        throw new TypeError(`Identity property ${property} is not declared by node ${type}.`);
      }
    }
    for (const property of Object.keys(shape)) assertPropertyName(property);
  }
  for (const [type, definition] of Object.entries(options.relationships)) {
    assertName(type, "relationship type");
    assertDescription(definition.description, `relationship ${type}`);
    if (!(definition.from in options.nodes) || !(definition.to in options.nodes)) {
      throw new TypeError(`Relationship ${type} references an unknown endpoint type.`);
    }
    if (!(definition.properties instanceof z.ZodObject)) {
      throw new TypeError(`Properties for relationship ${type} must be a Zod object schema.`);
    }
    assertExactPropertySchema(definition.properties, `relationship ${type}`);
    const identity = definition.identity ?? [];
    if (new Set(identity).size !== identity.length) {
      throw new TypeError(`Relationship ${type} contains duplicate identity properties.`);
    }
    for (const property of Object.keys(definition.properties.shape)) assertPropertyName(property);
    for (const property of identity) {
      if (!(property in definition.properties.shape)) {
        throw new TypeError(
          `Identity property ${property} is not declared by relationship ${type}.`,
        );
      }
    }
  }
  const nodes = Object.fromEntries(
    Object.entries(options.nodes).map(([type, definition]) => [
      type,
      Object.freeze({ ...definition, identity: Object.freeze([...definition.identity]) }),
    ]),
  );
  const relationships = Object.fromEntries(
    Object.entries(options.relationships).map(([type, definition]) => [
      type,
      Object.freeze({
        ...definition,
        ...(definition.identity === undefined
          ? {}
          : { identity: Object.freeze([...definition.identity]) }),
      }),
    ]),
  );
  return Object.freeze({
    nodes: Object.freeze(nodes),
    relationships: Object.freeze(relationships),
    kind: "neo4j-graph-schema" as const,
  }) as Neo4jGraphSchema<Options>;
}

export function parseNeo4jProperties(value: unknown, label: string): Neo4jProperties {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object of Neo4j property values.`);
  }
  const output: Record<string, Neo4jPropertyValue> = {};
  for (const [key, item] of Object.entries(value)) {
    assertPropertyName(key);
    output[key] = parseNeo4jPropertyValue(item, `${label}.${key}`);
  }
  return output;
}

export function parseNeo4jPropertyValue(value: unknown, label: string): Neo4jPropertyValue {
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite.`);
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
      throw new TypeError(`${label} must be a safe integer.`);
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return [];
    const parsed = value.map((item, index) => parsePrimitive(item, `${label}[${index}]`));
    const type = typeof parsed[0];
    if (!parsed.every((item) => typeof item === type)) {
      throw new TypeError(`${label} must be a homogeneous array.`);
    }
    return parsed as Neo4jPropertyValue;
  }
  throw new TypeError(`${label} is not a supported Neo4j property value.`);
}

function parsePrimitive(value: unknown, label: string): Neo4jPropertyPrimitive {
  const parsed = parseNeo4jPropertyValue(value, label);
  if (typeof parsed === "string" || typeof parsed === "number" || typeof parsed === "boolean") {
    return parsed;
  }
  throw new TypeError(`${label} must be a primitive property value.`);
}

export function assertName(value: string, label: string): void {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
}

export function assertPropertyName(value: string): void {
  assertName(value, "Neo4j property name");
  if (value.startsWith(reservedPrefix)) {
    throw new TypeError(`Neo4j property names beginning with ${reservedPrefix} are reserved.`);
  }
}

function assertDescription(value: string, label: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} requires a non-empty description.`);
  }
}

function assertExactPropertySchema(schema: z.ZodObject<z.ZodRawShape>, label: string): void {
  const definition = schema._zod.def;
  if (!(definition.catchall instanceof z.ZodNever)) {
    throw new TypeError(`${label} properties must use a strict Zod object schema.`);
  }
  for (const [property, propertySchema] of Object.entries(schema.shape)) {
    assertNonEffectfulSchema(propertySchema, `${label} property ${property}`, new Set());
  }
}

function assertNonEffectfulSchema(value: unknown, label: string, visited: Set<z.ZodType>): void {
  if (!(value instanceof z.ZodType)) {
    throw new TypeError(`${label} must be a Zod schema.`);
  }
  const schema = value;
  if (visited.has(schema)) return;
  visited.add(schema);
  const definition = schema._zod.def as unknown as Record<string, unknown>;
  const type = definition.type;
  if (
    definition.coerce === true ||
    type === "default" ||
    type === "prefault" ||
    type === "catch" ||
    type === "transform" ||
    type === "pipe"
  ) {
    throw new TypeError(
      `${label} must not coerce, default, transform, preprocess, or catch values.`,
    );
  }
  const checks = definition.checks;
  if (
    Array.isArray(checks) &&
    checks.some((check) => {
      if (typeof check !== "object" || check === null) return false;
      const internals = (check as { _zod?: { def?: { check?: unknown } } })._zod;
      return internals?.def?.check === "overwrite";
    })
  ) {
    throw new TypeError(`${label} must not normalize or overwrite values.`);
  }
  for (const child of schemaChildren(definition)) {
    assertNonEffectfulSchema(child, label, visited);
  }
}

function schemaChildren(definition: Record<string, unknown>): z.ZodType[] {
  const children: z.ZodType[] = [];
  for (const key of ["innerType", "element", "left", "right", "rest", "keyType", "valueType"]) {
    const value = definition[key];
    if (value instanceof z.ZodType) children.push(value);
  }
  for (const key of ["options", "items"]) {
    const value = definition[key];
    if (Array.isArray(value)) {
      for (const item of value) if (item instanceof z.ZodType) children.push(item);
    }
  }
  return children;
}
