import type { VectorMetadata, VectorMetadataValue } from "../embeddings";
import type { VectorFilter, VectorFilterList } from "./types";

export type {
  VectorFilter,
  VectorFilterComparisonOperator,
  VectorFilterList,
  VectorFilterOperator,
} from "./types";

export const vectorFilter = {
  eq(key: string, value: VectorMetadataValue): VectorFilter {
    return { type: "eq", key, value };
  },
  ne(key: string, value: VectorMetadataValue): VectorFilter {
    return { type: "ne", key, value };
  },
  gt(key: string, value: VectorMetadataValue): VectorFilter {
    return { type: "gt", key, value };
  },
  gte(key: string, value: VectorMetadataValue): VectorFilter {
    return { type: "gte", key, value };
  },
  lt(key: string, value: VectorMetadataValue): VectorFilter {
    return { type: "lt", key, value };
  },
  lte(key: string, value: VectorMetadataValue): VectorFilter {
    return { type: "lte", key, value };
  },
  in(key: string, values: readonly VectorMetadataValue[]): VectorFilter {
    return { type: "in", key, values: [...values] };
  },
  and(...filters: VectorFilterList): VectorFilter {
    return { type: "and", filters };
  },
  or(...filters: VectorFilterList): VectorFilter {
    return { type: "or", filters };
  },
};

export function matchesVectorFilter(
  metadata: VectorMetadata | undefined,
  filter: VectorFilter | undefined,
): boolean {
  if (filter === undefined) {
    return true;
  }
  if (metadata === undefined) {
    return false;
  }

  switch (filter.type) {
    case "eq":
      return metadata[filter.key] === filter.value;
    case "ne":
      return metadata[filter.key] !== filter.value;
    case "gt":
      return (compare(metadata[filter.key], filter.value) ?? 0) > 0;
    case "gte": {
      const result = compare(metadata[filter.key], filter.value);
      return result !== undefined && result >= 0;
    }
    case "lt":
      return (compare(metadata[filter.key], filter.value) ?? 0) < 0;
    case "lte": {
      const result = compare(metadata[filter.key], filter.value);
      return result !== undefined && result <= 0;
    }
    case "in": {
      const value = metadata[filter.key];
      return value !== undefined && filter.values.includes(value);
    }
    case "and":
      return filter.filters.every((child) => matchesVectorFilter(metadata, child));
    case "or":
      return filter.filters.some((child) => matchesVectorFilter(metadata, child));
  }
}

function compare(
  left: VectorMetadataValue | undefined,
  right: VectorMetadataValue,
): number | undefined {
  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }
  if (typeof left === "string" && typeof right === "string") {
    return left.localeCompare(right);
  }
  if (typeof left === "boolean" && typeof right === "boolean") {
    return Number(left) - Number(right);
  }
  return undefined;
}
