import type { VectorFilter } from "@anvia/core/vector-store";

const comparisonOperators = {
  eq: "Equal",
  ne: "NotEqual",
  gt: "GreaterThan",
  gte: "GreaterThanEqual",
  lt: "LessThan",
  lte: "LessThanEqual",
} as const;

export function filterToWeaviateWhere(filter: VectorFilter | undefined): unknown {
  if (filter === undefined) {
    return undefined;
  }

  switch (filter.type) {
    case "eq":
    case "ne":
    case "gt":
    case "gte":
    case "lt":
    case "lte":
      return {
        operator: comparisonOperators[filter.type],
        target: { property: filter.key },
        value: filter.value,
      };
    case "in":
      if (filter.values.length === 0) {
        throw new Error(`Weaviate "in" filter for ${filter.key} requires at least one value`);
      }
      if (filter.values.includes(null)) {
        throw new Error(
          `Weaviate does not support null values in "in" filters (property ${filter.key})`,
        );
      }
      return {
        operator: "ContainsAny",
        target: { property: filter.key },
        value: filter.values,
      };
    case "and":
      return {
        operator: "And",
        filters: filter.filters.map(filterToWeaviateWhere),
        value: null,
      };
    case "or":
      return {
        operator: "Or",
        filters: filter.filters.map(filterToWeaviateWhere),
        value: null,
      };
  }
}
