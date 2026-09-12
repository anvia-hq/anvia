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
 * Converts a Standard Schema to the JSON Schema sent to providers when the
 * conversion can happen synchronously; otherwise returns the schema as pending
 * so callers can resolve it asynchronously with
 * {@link toProviderJsonSchemaFromStandardSchema}.
 *
 * Providers receive the schema's input representation: the raw provider
 * response is what `~standard.validate` receives as its validation input,
 * while the validated (possibly transformed) value becomes the completion
 * output.
 */
export function tryToProviderJsonSchemaFromStandardSchema(
  schema: StandardSchemaV1,
): StandardSchemaJsonSchemaConversion {
  const props = schema["~standard"];
  // Zod keeps its native converter. Prefer the output representation: it
  // validates identically for schemas without input/output differences and
  // carries zod's strict-object refinements (additionalProperties: false)
  // that provider strict modes such as OpenAI structured outputs require.
  if (props.vendor === "zod") {
    return { jsonSchema: toProviderZodJsonSchema(schema as z.ZodType) };
  }
  // Generic support for any library implementing the Standard JSON Schema spec.
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
  // Vendor-specific converters may need to be loaded asynchronously.
  return { pendingSchema: schema };
}

function toProviderZodJsonSchema(schema: z.ZodType): JsonObject {
  try {
    return toProviderJsonSchema(schema, { io: "output" });
  } catch {
    // Transformed schemas are unrepresentable on the output side. Describe the
    // validation input instead so the provider emits values the schema
    // accepts, and the transformed output becomes the completion result.
    return toProviderJsonSchema(schema, { io: "input" });
  }
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
  const { $schema: _schema, ...providerSchema } = jsonSchema;
  // JSON Schema documents are JSON values by construction.
  return providerSchema as JsonObject;
}
