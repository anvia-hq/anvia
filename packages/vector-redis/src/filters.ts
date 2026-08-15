import type { VectorFilter } from "@anvia/core/vector-store";
import { redisTagValue } from "./helpers.js";
import type { RedisMetadataFieldType, RedisMetadataSchema } from "./types.js";

export function filterToRedisQuery(options: {
  filter?: VectorFilter | undefined;
  metadataSchema: RedisMetadataSchema;
}): string {
  if (options.filter === undefined) {
    return "*";
  }

  return `(${translateFilter(options.filter, options.metadataSchema)})`;
}

function translateFilter(
  filter: VectorFilter,
  metadataSchema: Record<string, RedisMetadataFieldType>,
): string {
  const fieldType = "key" in filter ? metadataSchema[filter.key] : undefined;
  if ("key" in filter && fieldType === undefined) {
    throw new TypeError(
      `Redis metadata filter field ${filter.key} must be declared in vectorStore({ metadataSchema })`,
    );
  }
  switch (filter.type) {
    case "eq": {
      if (fieldType === "numeric") {
        if (typeof filter.value !== "number" || !Number.isFinite(filter.value)) {
          throw new TypeError(
            `Redis numeric metadata field ${filter.key} requires numeric filters`,
          );
        }
        return `@${filter.key}:[${filter.value} ${filter.value}]`;
      }
      return `@${filter.key}:{${escapeRedisValue(redisTagValue(filter.value))}}`;
    }
    case "gt": {
      assertNumericFilter(filter.key, filter.value, fieldType);
      return `@${filter.key}:[(${filter.value} +inf]`;
    }
    case "lt": {
      assertNumericFilter(filter.key, filter.value, fieldType);
      return `@${filter.key}:[-inf (${filter.value}]`;
    }
    case "and":
      return filter.filters.map((f) => `(${translateFilter(f, metadataSchema)})`).join(" ");
    case "or":
      return filter.filters.map((f) => `(${translateFilter(f, metadataSchema)})`).join(" | ");
  }
}

function assertNumericFilter(
  key: string,
  value: unknown,
  fieldType: RedisMetadataFieldType | undefined,
): asserts value is number {
  if (fieldType !== "numeric" || typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`Redis range filter field ${key} must be declared as numeric metadata`);
  }
}

function escapeRedisValue(value: string): string {
  return value.replace(/([,.<>{}[\]"':;!@#$%^&*()\-+=~|\\/ ])/g, "\\$1");
}
