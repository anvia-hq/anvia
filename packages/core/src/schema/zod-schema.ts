import { z } from "zod";
import type { JsonObject } from "../completion/index";

export type ZodSchema<T = unknown> = z.ZodType<T>;

export function toProviderJsonSchema(schema: z.ZodType): JsonObject {
  const jsonSchema = z.toJSONSchema(schema) as JsonObject;
  const { $schema: _schema, ...providerSchema } = jsonSchema;
  return providerSchema;
}
