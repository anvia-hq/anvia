import type { VectorFilter } from "@anvia/core/vector-store";

export function filterToWeaviateWhere(filter: VectorFilter | undefined): unknown {
  if (filter === undefined) {
    return undefined;
  }

  switch (filter.type) {
    case "eq":
      return {
        operator: "Equal",
        target: { property: filter.key },
        value: filter.value,
      };
    case "gt":
      return {
        operator: "GreaterThan",
        target: { property: filter.key },
        value: filter.value,
      };
    case "lt":
      return {
        operator: "LessThan",
        target: { property: filter.key },
        value: filter.value,
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
