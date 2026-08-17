import type { JsonObject } from "../completion";
import { toProviderJsonSchema, type ZodSchema } from "../schema/zod-schema";

const providerOutputSchemas = new WeakMap<object, JsonObject>();

export function registerAgentProviderOutputSchema(
  agent: object,
  schema: ZodSchema | undefined,
): void {
  if (schema !== undefined) {
    providerOutputSchemas.set(agent, toProviderJsonSchema(schema));
  }
}

export function getAgentProviderOutputSchema(agent: object): JsonObject | undefined {
  return providerOutputSchemas.get(agent);
}
