import { toJSONSchema, type z } from "zod";
import type { JsonObject } from "../completion/index";

export type ZodSchema<T = unknown> = z.ZodType<T>;

export function toProviderJsonSchema(
  schema: z.ZodType,
  options: { io?: "input" | "output" } = {},
): JsonObject {
  const jsonSchema = toJSONSchema(schema, options) as JsonObject;
  const { $schema: _schema, ...providerSchema } = jsonSchema;
  return providerSchema;
}
