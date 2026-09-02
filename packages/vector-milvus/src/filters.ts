import type { VectorFilter } from "@anvia/core/vector-store";

const milvusIdentifierPattern = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;

const milvusExpressionKeywords = new Set([
  "and",
  "or",
  "not",
  "exists",
  "in",
  "like",
  "is",
  "null",
  "true",
  "false",
  "json_contains",
  "json_contains_all",
  "json_contains_any",
  "array_contains",
  "array_contains_all",
  "array_contains_any",
  "array_length",
  "text_match",
  "phrase_match",
  "random_sample",
]);

export function filterToMilvusExpr(filter: VectorFilter | undefined): string | undefined {
  if (filter === undefined) {
    return undefined;
  }

  switch (filter.type) {
    case "eq": {
      const key = sanitizeFilterKey(filter.key);
      const val = milvusLiteral(filter.value);
      return `${key} == ${val}`;
    }
    case "gt": {
      const key = sanitizeFilterKey(filter.key);
      const val = milvusLiteral(filter.value);
      return `${key} > ${val}`;
    }
    case "lt": {
      const key = sanitizeFilterKey(filter.key);
      const val = milvusLiteral(filter.value);
      return `${key} < ${val}`;
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

function sanitizeFilterKey(key: string): string {
  if (!milvusIdentifierPattern.test(key)) {
    throw new Error(
      `Invalid metadata filter key: "${key}". Filter keys must start with a letter or underscore,` +
        ` and contain only alphanumeric characters, underscores, and dots for nested fields.`,
    );
  }
  for (const segment of key.split(".")) {
    if (milvusExpressionKeywords.has(segment.toLowerCase())) {
      throw new Error(
        `Invalid metadata filter key: "${key}". The segment "${segment}" is a reserved Milvus ` +
          `expression keyword.`,
      );
    }
  }
  return key;
}

function milvusLiteral(value: string | number | boolean | null): string {
  if (value === null) {
    return "null";
  }
  if (typeof value === "string") {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error(
      `Invalid metadata filter value: ${value}. Numeric filter values must be finite.`,
    );
  }
  return String(value);
}
