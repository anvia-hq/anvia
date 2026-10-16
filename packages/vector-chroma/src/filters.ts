import type { VectorFilter } from "@anvia/core/vector-store";

export function filterToChromaWhere(filter: VectorFilter | undefined): unknown {
  if (filter === undefined) {
    return undefined;
  }

  switch (filter.type) {
    case "eq":
      return { [filter.key]: { $eq: filter.value } };
    case "ne":
      return { [filter.key]: { $ne: filter.value } };
    case "gt":
      return { [filter.key]: { $gt: filter.value } };
    case "gte":
      return { [filter.key]: { $gte: filter.value } };
    case "lt":
      return { [filter.key]: { $lt: filter.value } };
    case "lte":
      return { [filter.key]: { $lte: filter.value } };
    case "in":
      if (filter.values.length === 0) {
        throw new Error(`Chroma "in" filter for ${filter.key} requires at least one value`);
      }
      return { [filter.key]: { $in: filter.values } };
    case "and":
    case "or": {
      if (filter.filters.length === 0) {
        throw new Error(`Chroma "${filter.type}" filter requires at least one child filter`);
      }
      // Chroma rejects $and/$or with fewer than two expressions.
      if (filter.filters.length === 1) {
        return filterToChromaWhere(filter.filters[0]);
      }
      const operator = filter.type === "and" ? "$and" : "$or";
      return { [operator]: filter.filters.map(filterToChromaWhere) };
    }
  }
}
