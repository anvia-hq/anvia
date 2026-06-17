import type { VectorFilter } from "@anvia/core/vector-store";

export function filterToChromaWhere(filter: VectorFilter | undefined): unknown {
  if (filter === undefined) {
    return undefined;
  }

  switch (filter.type) {
    case "eq":
      return { [filter.key]: { $eq: filter.value } };
    case "gt":
      return { [filter.key]: { $gt: filter.value } };
    case "lt":
      return { [filter.key]: { $lt: filter.value } };
    case "and":
      return { $and: filter.filters.map(filterToChromaWhere) };
    case "or":
      return { $or: filter.filters.map(filterToChromaWhere) };
  }
}
