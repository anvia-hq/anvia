import type { VectorFilter } from "@anvia/core/vector-store";

export function filterToQdrantFilter(filter: VectorFilter | undefined): unknown {
  if (filter === undefined) {
    return undefined;
  }

  switch (filter.type) {
    case "eq":
      return { must: [{ key: filter.key, match: { value: filter.value } }] };
    case "ne":
      return { must_not: [{ key: filter.key, match: { value: filter.value } }] };
    case "gt":
      return { must: [{ key: filter.key, range: { gt: filter.value } }] };
    case "gte":
      return { must: [{ key: filter.key, range: { gte: filter.value } }] };
    case "lt":
      return { must: [{ key: filter.key, range: { lt: filter.value } }] };
    case "lte":
      return { must: [{ key: filter.key, range: { lte: filter.value } }] };
    case "in":
      if (filter.values.length === 0) {
        throw new Error(`Qdrant "in" filter for ${filter.key} requires at least one value`);
      }
      return { must: [{ key: filter.key, match: { any: filter.values } }] };
    case "and":
      return { must: filter.filters.map(filterToQdrantFilter) };
    case "or":
      return { should: filter.filters.map(filterToQdrantFilter) };
  }
}
