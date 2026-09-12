import type { z } from "zod";
import type { JsonObject } from "../completion/index";
import type { StandardJSONSchemaV1, StandardSchemaV1 } from "./standard-schema";
import { toProviderJsonSchema } from "./zod-schema";

const JSON_SCHEMA_TARGET = "draft-2020-12";

/** The outcome of converting a Standard Schema to a provider JSON Schema. */
export type StandardSchemaJsonSchemaConversion =
  | { readonly jsonSchema: JsonObject; readonly pendingSchema?: undefined }
  | { readonly jsonSchema?: undefined; readonly pendingSchema: StandardSchemaV1 };

/**
 * Converts a Standard Schema to a provider JSON Schema when the conversion can
 * happen synchronously; otherwise returns the schema as pending so callers can
 * resolve it asynchronously with
 * {@link toProviderJsonSchemaFromStandardSchema}.
 */
export function tryToProviderJsonSchemaFromStandardSchema(
  schema: StandardSchemaV1,
  options: { io?: "input" | "output" } = {},
): StandardSchemaJsonSchemaConversion {
  const props = schema["~standard"];
  // Zod keeps its native converter so existing behavior is unchanged.
  if (props.vendor === "zod") {
    return { jsonSchema: toProviderJsonSchema(schema as z.ZodType, options) };
  }
  // Generic support for any library implementing the Standard JSON Schema spec.
  const jsonSchema = (
    props as {
      jsonSchema?: StandardJSONSchemaV1["~standard"]["jsonSchema"] | undefined;
    }
  ).jsonSchema;
  if (typeof jsonSchema === "object" && jsonSchema !== null) {
    const convert = options.io === "input" ? jsonSchema.input : jsonSchema.output;
    return { jsonSchema: toProviderJsonSchemaShape(convert({ target: JSON_SCHEMA_TARGET })) };
  }
  // Vendor-specific converters may need to be loaded asynchronously.
  return { pendingSchema: schema };
}

/**
 * Converts any supported Standard Schema to a provider JSON Schema. Synchronously
 * convertible schemas resolve immediately; Valibot schemas load the optional
 * `@valibot/to-json-schema` converter on first use.
 */
export async function toProviderJsonSchemaFromStandardSchema(
  schema: StandardSchemaV1,
  options: { io?: "input" | "output" } = {},
): Promise<JsonObject> {
  const converted = tryToProviderJsonSchemaFromStandardSchema(schema, options);
  if (converted.jsonSchema !== undefined) return converted.jsonSchema;
  const pending = converted.pendingSchema;
  const vendor = pending["~standard"].vendor;
  if (vendor === "valibot") {
    return valibotToProviderJsonSchema(pending, options);
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

async function valibotToProviderJsonSchema(
  schema: StandardSchemaV1,
  options: { io?: "input" | "output" },
): Promise<JsonObject> {
  const { toJsonSchema } = await loadValibotToJsonSchema();
  const jsonSchema = toJsonSchema(schema, {
    target: JSON_SCHEMA_TARGET,
    typeMode: options.io === "input" ? "input" : "output",
  });
  return toProviderJsonSchemaShape(jsonSchema);
}

function toProviderJsonSchemaShape(jsonSchema: Record<string, unknown>): JsonObject {
  const { $schema: _schema, ...providerSchema } = jsonSchema;
  // JSON Schema documents are JSON values by construction.
  return providerSchema as JsonObject;
}
