import type { VectorMetadata, VectorMetadataValue } from "../embeddings";
import type { VectorFilter } from "./types";

export type { VectorFilter } from "./types";

export const vectorFilter = {
  eq(key: string, value: VectorMetadataValue): VectorFilter {
    return { type: "eq", key, value };
  },
  gt(key: string, value: VectorMetadataValue): VectorFilter {
    return { type: "gt", key, value };
  },
  lt(key: string, value: VectorMetadataValue): VectorFilter {
    return { type: "lt", key, value };
  },
  and(left: VectorFilter, right: VectorFilter): VectorFilter {
    return { type: "and", filters: [left, right] };
  },
  or(left: VectorFilter, right: VectorFilter): VectorFilter {
    return { type: "or", filters: [left, right] };
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
    case "gt":
      return compare(metadata[filter.key], filter.value) > 0;
    case "lt":
      return compare(metadata[filter.key], filter.value) < 0;
    case "and":
      return (
        matchesVectorFilter(metadata, filter.filters[0]) &&
        matchesVectorFilter(metadata, filter.filters[1])
      );
    case "or":
      return (
        matchesVectorFilter(metadata, filter.filters[0]) ||
        matchesVectorFilter(metadata, filter.filters[1])
      );
  }
}

function compare(left: VectorMetadataValue | undefined, right: VectorMetadataValue): number {
  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }
  if (typeof left === "string" && typeof right === "string") {
    return left.localeCompare(right);
  }
  if (typeof left === "boolean" && typeof right === "boolean") {
    return Number(left) - Number(right);
  }
  return 0;
}
