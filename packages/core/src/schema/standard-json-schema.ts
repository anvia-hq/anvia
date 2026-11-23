import type { z } from "zod";
import type { JsonObject, JsonValue } from "../completion/types";
import type { StandardJSONSchemaV1, StandardSchemaV1 } from "./standard-schema";
import { toProviderJsonSchema } from "./zod-schema";

const JSON_SCHEMA_TARGET = "draft-2020-12";

/** The outcome of converting a Standard Schema to a provider JSON Schema. */
export type StandardSchemaJsonSchemaConversion =
  | { readonly jsonSchema: JsonObject; readonly pendingSchema?: undefined }
  | { readonly jsonSchema?: undefined; readonly pendingSchema: StandardSchemaV1 };

/**
 * Converts a Standard Schema to the JSON Schema sent to providers when the
 * conversion can happen synchronously; otherwise returns the schema as pending
 * so callers can resolve it asynchronously with
 * {@link toProviderJsonSchemaFromStandardSchema}.
 *
 * Providers receive the schema's input representation: the raw provider
 * response is what `~standard.validate` receives as its validation input,
 * while the validated (possibly transformed) value becomes the completion
 * output. Object nodes are completed with `additionalProperties: false` so
 * payloads remain eligible for provider strict modes such as OpenAI
 * structured outputs.
 */
export function tryToProviderJsonSchemaFromStandardSchema(
  schema: StandardSchemaV1,
): StandardSchemaJsonSchemaConversion {
  const props = schema["~standard"];

  if (props.vendor === "zod") {
    return {
      jsonSchema: toProviderJsonSchemaShape(toProviderZodJsonSchema(schema as z.ZodType)),
    };
  }

  const jsonSchema = (
    props as {
      jsonSchema?: StandardJSONSchemaV1["~standard"]["jsonSchema"] | undefined;
    }
  ).jsonSchema;

  if (typeof jsonSchema === "object" && jsonSchema !== null) {
    return {
      jsonSchema: toProviderJsonSchemaShape(jsonSchema.input({ target: JSON_SCHEMA_TARGET })),
    };
  }

  return { pendingSchema: schema };
}

function toProviderZodJsonSchema(schema: z.ZodType): JsonObject {
  let outputJsonSchema: JsonObject;
  try {
    outputJsonSchema = toProviderJsonSchema(schema, { io: "output" });
  } catch {
    return toProviderJsonSchema(schema, { io: "input" });
  }
  let inputJsonSchema: JsonObject;
  try {
    inputJsonSchema = toProviderJsonSchema(schema, { io: "input" });
  } catch {
    return outputJsonSchema;
  }
  return jsonSchemaMatchesInputShape(inputJsonSchema, outputJsonSchema)
    ? outputJsonSchema
    : inputJsonSchema;
}

/** Checks whether the output-side schema shape equals the input-side shape, ignoring strictness. */
function jsonSchemaMatchesInputShape(input: JsonValue, output: JsonValue): boolean {
  if (Array.isArray(input) || Array.isArray(output)) {
    return (
      Array.isArray(input) &&
      Array.isArray(output) &&
      input.length === output.length &&
      input.every((item, index) => jsonSchemaMatchesInputShape(item, output[index]))
    );
  }

  if (
    typeof input === "object" &&
    input !== null &&
    typeof output === "object" &&
    output !== null
  ) {
    const inputKeys = Object.keys(input).sort();
    const outputKeys = Object.keys(output)
      .filter((key) => key !== "additionalProperties")
      .sort();
    return (
      inputKeys.length === outputKeys.length &&
      inputKeys.every((key, index) => {
        const outputKey = outputKeys[index];

        if (outputKey === undefined || key !== outputKey) return false;

        const inputValue = (input as Record<string, JsonValue>)[key] as JsonValue;
        const outputValue = (output as Record<string, JsonValue>)[outputKey] as JsonValue;
        return jsonSchemaMatchesInputShape(inputValue, outputValue);
      })
    );
  }

  return input === output;
}

/**
 * Converts any supported Standard Schema to the JSON Schema sent to providers.
 * Synchronously convertible schemas resolve immediately; Valibot schemas load
 * the optional `@valibot/to-json-schema` converter on first use.
 */
export async function toProviderJsonSchemaFromStandardSchema(
  schema: StandardSchemaV1,
): Promise<JsonObject> {
  const converted = tryToProviderJsonSchemaFromStandardSchema(schema);

  if (converted.jsonSchema !== undefined) return converted.jsonSchema;

  const pending = converted.pendingSchema;
  const vendor = pending["~standard"].vendor;

  if (vendor === "valibot") {
    return valibotToProviderJsonSchema(pending);
  }

  throw new Error(
    `Structured output schemas from vendor "${vendor}" cannot be converted to a provider JSON schema. ` +
      `Use a Zod or Valibot schema, or make the schema implement the Standard JSON Schema interface ("~standard.jsonSchema").`,
  );
}

type ValibotToJsonSchemaModule = {
  toJsonSchema: (
    schema: StandardSchemaV1,
    config?: {
      readonly target?: "draft-07" | "draft-2020-12" | "openapi-3.0" | undefined;
      readonly typeMode?: "ignore" | "input" | "output" | undefined;
    },
  ) => Record<string, unknown>;
};

let valibotToJsonSchemaModule: Promise<ValibotToJsonSchemaModule> | undefined;

async function loadValibotToJsonSchema(): Promise<ValibotToJsonSchemaModule> {
  valibotToJsonSchemaModule ??=
    import("@valibot/to-json-schema") as unknown as Promise<ValibotToJsonSchemaModule>;
  try {
    return await valibotToJsonSchemaModule;
  } catch (error) {
    valibotToJsonSchemaModule = undefined;
    throw new Error(
      'The structured output schema is a Valibot schema, but "@valibot/to-json-schema" is not installed. ' +
        "Install it to use Valibot schemas for structured output.",
      { cause: error },
    );
  }
}

async function valibotToProviderJsonSchema(schema: StandardSchemaV1): Promise<JsonObject> {
  const { toJsonSchema } = await loadValibotToJsonSchema();
  const jsonSchema = toJsonSchema(schema, {
    target: JSON_SCHEMA_TARGET,
    typeMode: "input",
  });
  return toProviderJsonSchemaShape(jsonSchema);
}

function toProviderJsonSchemaShape(jsonSchema: Record<string, unknown>): JsonObject {
  const providerSchema = copyProviderSchema(jsonSchema);
  completeStrictObjectRefinements(providerSchema);
  return providerSchema;
}

function copyProviderSchema(source: unknown): JsonObject {
  if (typeof source !== "object" || source === null || Array.isArray(source)) {
    throw new TypeError("Provider JSON schema must be a plain or null-prototype record.");
  }

  return copyJsonData(source, new WeakSet(), true) as JsonObject;
}

function copyJsonData(
  value: unknown,
  ancestors: WeakSet<object>,
  omitRootSchema = false,
): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return value;
  }

  if (typeof value !== "object") {
    throw new TypeError("Provider JSON schema must contain only finite JSON data.");
  }

  if (ancestors.has(value)) {
    throw new TypeError("Provider JSON schema must not contain cycles.");
  }

  ancestors.add(value);

  if (Array.isArray(value)) {
    const copy: JsonValue[] = [];
    for (let index = 0; index < value.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));

      if (descriptor === undefined || !("value" in descriptor)) {
        throw new TypeError(
          "Provider JSON schema arrays must be dense data arrays without accessors.",
        );
      }

      copy.push(copyJsonData(descriptor.value, ancestors));
    }
    ancestors.delete(value);
    return copy;
  }

  const prototype = Object.getPrototypeOf(value);

  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Provider JSON schema must contain only plain or null-prototype records.");
  }

  const copy: JsonObject = {};
  for (const key of Object.keys(value)) {
    if (omitRootSchema && key === "$schema") continue;

    const descriptor = Object.getOwnPropertyDescriptor(value, key);

    if (descriptor === undefined || !("value" in descriptor)) {
      throw new TypeError("Provider JSON schema records must not contain enumerable accessors.");
    }

    Object.defineProperty(copy, key, {
      value: copyJsonData(descriptor.value, ancestors),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  ancestors.delete(value);
  return copy;
}

/**
 * Adds `additionalProperties: false` to object schema nodes that do not declare
 * it. Restricting the provider to declared properties is validation-safe
 * because schema libraries strip or accept unknown input keys, and provider
 * strict modes such as OpenAI structured outputs require the refinement.
 * Explicit values (for example permissive objects) are left untouched.
 *
 * Recursion follows schema-bearing keywords only, so literal values under
 * `const`, `enum`, `default`, `examples`, or extension keywords — which may
 * legitimately be objects with a `type` field — are never rewritten.
 */
function completeStrictObjectRefinements(jsonSchema: unknown): void {
  completeSchemaNode(jsonSchema);
}

const SCHEMA_POSITIONS: ReadonlySet<string> = new Set([
  "additionalItems",
  "additionalProperties",
  "allOf",
  "anyOf",
  "contains",
  "contentSchema",
  "else",
  "if",
  "items",
  "not",
  "oneOf",
  "prefixItems",
  "propertyNames",
  "then",
  "unevaluatedItems",
  "unevaluatedProperties",
]);

const SCHEMA_MAP_POSITIONS: ReadonlySet<string> = new Set([
  "$defs",
  "definitions",
  "dependencies",
  "dependentSchemas",
  "patternProperties",
  "properties",
]);

function completeSchemaNode(node: unknown): void {
  if (Array.isArray(node)) {
    for (const item of node) completeSchemaNode(item);
    return;
  }

  if (typeof node !== "object" || node === null) return;

  const schema = node as Record<string, unknown>;

  if (schema.type === "object" && schema.additionalProperties === undefined) {
    schema.additionalProperties = false;
  }

  for (const [key, value] of Object.entries(schema)) {
    if (SCHEMA_POSITIONS.has(key)) {
      completeSchemaNode(value);
    } else if (
      SCHEMA_MAP_POSITIONS.has(key) &&
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value)
    ) {
      for (const child of Object.values(value)) completeSchemaNode(child);
    }
  }
}
