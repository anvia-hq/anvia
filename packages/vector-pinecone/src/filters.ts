import type { VectorFilter } from "@anvia/core/vector-store";

export function filterToPineconeFilter(filter: VectorFilter | undefined): unknown {
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
        throw new Error(`Pinecone "in" filter for ${filter.key} requires at least one value`);
      }
      return { [filter.key]: { $in: filter.values } };
    case "and":
      return { $and: filter.filters.map(filterToPineconeFilter) };
    case "or":
      return { $or: filter.filters.map(filterToPineconeFilter) };
  }
}
