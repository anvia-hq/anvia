import type { VectorFilter } from "@anvia/core/vector-store";

export function filterToMilvusExpr(filter: VectorFilter | undefined): string | undefined {
  if (filter === undefined) {
    return undefined;
  }

  switch (filter.type) {
    case "eq": {
      const val = milvusLiteral(filter.value);
      return `${filter.key} == ${val}`;
    }
    case "gt": {
      const val = milvusLiteral(filter.value);
      return `${filter.key} > ${val}`;
    }
    case "lt": {
      const val = milvusLiteral(filter.value);
      return `${filter.key} < ${val}`;
    }
    case "and": {
      const parts = filter.filters
        .map(filterToMilvusExpr)
        .filter((part): part is string => part !== undefined);
      return parts.length > 0 ? parts.map((p) => `(${p})`).join(" && ") : undefined;
    }
    case "or": {
      const parts = filter.filters
        .map(filterToMilvusExpr)
        .filter((part): part is string => part !== undefined);
      return parts.length > 0 ? parts.map((p) => `(${p})`).join(" || ") : undefined;
    }
  }
}

function milvusLiteral(value: string | number | boolean | null): string {
  if (value === null) {
    return "null";
  }
  if (typeof value === "string") {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return String(value);
}
