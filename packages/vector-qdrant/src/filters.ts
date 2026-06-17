import type { VectorFilter } from "@anvia/core/vector-store";

export function filterToQdrantFilter(filter: VectorFilter | undefined): unknown {
  if (filter === undefined) {
    return undefined;
  }

  switch (filter.type) {
    case "eq":
      return { must: [{ key: filter.key, match: { value: filter.value } }] };
    case "gt":
      return { must: [{ key: filter.key, range: { gt: filter.value } }] };
    case "lt":
      return { must: [{ key: filter.key, range: { lt: filter.value } }] };
    case "and":
      return { must: filter.filters.map(filterToQdrantFilter) };
    case "or":
      return { should: filter.filters.map(filterToQdrantFilter) };
  }
}
